// Garra Delivery - Core Application Logic

// Supabase Configuration
const supabaseUrl = 'https://evupemncvectyyeoeajz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2dXBlbW5jdmVjdHl5ZW9lYWp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NjEyOTEsImV4cCI6MjA5NjMzNzI5MX0.QKW38pTwzkkTUKZqz5JUopOws9ftWJBYHMF4xICxips';
let supabaseClient = null;
let maxSimultaneousDeliveries = 1;
if (window.supabase) {
  supabaseClient = window.supabase.createClient(supabaseUrl, supabaseKey);
} else {
  console.error("Supabase SDK not loaded!");
}

// Mock Database States (updated dynamically from Supabase)
const mockData = {
  activeProfile: 'owner', // 'owner', 'client', 'order'
  fleet: [],
  clientHistory: [],
  credentials: {
    owner: { email: 'admin@garradelivery.com.br', pass: 'admin123', name: 'Gustavo Souza', role: 'Dono & CEO', avatar: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?q=80&w=256&auto=format&fit=crop' },
    client: { email: 'gerente@burgerchef.com.br', pass: 'burger123', name: 'Roberto Heinz', role: 'Gerente - Burger Chef', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=256&auto=format&fit=crop' },
    order: { email: 'pedido@burgerchef.com.br', pass: 'express123', name: 'Roberto Heinz', role: 'Gerente - Burger Chef', avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=256&auto=format&fit=crop' }
  },
  pendingDeliveries: []
};

// Escapes HTML-special characters so values from the database can never be
// rendered as markup (prevents stored XSS via fields like address/name).
function escapeHtml(value) {
  if (value === null || value === undefined) return value;
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Global Chart and Map variables to allow proper reset/destroy
let ownerFleetMap = null;
let ownerOverviewChart = null;
let ownerFinancialChart = null;
let clientOverviewChart = null;
let selectedRiderId = null;
let selectedMapRiderId = null;
let trackingMapInstance = null;
let trackingRiderMarker = null;
let trackingPickupMarker = null;
let trackingDestMarker = null;
let trackingRouteLine = null;
let trackingRealtimeChannel = null;
// Global support chat variables
let activeChatClientEmail = null;
let activeChatClientName = null;
let supportChatChannel = null;
let clientRatings = [
  { score: 5, title: 'Entrega rápida e cordial', comment: 'Motoboy chegou antes do prazo e manteve o pedido em perfeito estado.', date: 'Hoje, 14:20' },
  { score: 5, title: 'Coleta sem espera', comment: 'Fluxo funcionou bem no horário de pico.', date: 'Ontem, 21:10' },
  { score: 4, title: 'Boa comunicação', comment: 'Avisou sobre o trânsito e finalizou sem atraso relevante.', date: 'Terça, 19:35' }
];

// Async functions to sync with Supabase
async function fetchFleet() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('fleet')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw error;
    mockData.fleet = data.map(item => ({
      id: String(item.id),
      name: item.name,
      vehicle: item.vehicle,
      plate: item.plate,
      status: item.status,
      delivery: item.delivery,
      battery: item.battery,
      rating: parseFloat(item.rating),
      statusClass: item.status_class,
      pin: item.pin || '—',
      bypassDistanceLimit: !!item.bypass_distance_limit,
      maxSimultaneousDeliveries: parseInt(item.max_simultaneous_deliveries) || 1,
      lat: item.lat,
      lng: item.lng
    }));
  } catch (err) {
    console.error("Error fetching fleet from Supabase:", err);
  }
}

// Generate next sequential Motoboy ID (#MB-0001, #MB-0002, ...)
async function getNextRiderID() {
  let maxNum = 0;
  if (supabaseClient) {
    const { data } = await supabaseClient.from('fleet').select('id');
    (data || []).forEach(item => {
      const match = (item.id || '').match(/#MB-(\d+)/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
    });
  } else {
    mockData.fleet.forEach(r => {
      const match = (r.id || '').match(/#MB-(\d+)/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
    });
  }
  return '#MB-' + String(maxNum + 1).padStart(4, '0');
}

async function fetchClientHistory() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('client_history')
      .select('*')
      .order('id', { ascending: false });
    if (error) throw error;
    mockData.clientHistory = data.map(item => ({
      id: escapeHtml(String(item.id)),
      destName: escapeHtml(item.dest_name),
      address: escapeHtml(item.address),
      rider: escapeHtml(item.rider),
      dist: escapeHtml(item.dist),
      price: escapeHtml(item.price),
      date: escapeHtml(item.date),
      status: escapeHtml(item.status),
      statusClass: escapeHtml(item.status_class)
    }));
  } catch (err) {
    console.error("Error fetching client history from Supabase:", err);
  }
}

async function fetchPendingDeliveries() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('pending_deliveries')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw error;
    mockData.pendingDeliveries = data.map(item => ({
      id: escapeHtml(String(item.id)),
      client: escapeHtml(item.client),
      destName: escapeHtml(item.dest_name),
      address: escapeHtml(item.address),
      dist: escapeHtml(item.dist),
      price: escapeHtml(item.price),
      payment: escapeHtml(item.payment),
      cargo: escapeHtml(item.cargo)
    }));
  } catch (err) {
    console.error("Error fetching pending deliveries from Supabase:", err);
  }
}

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('Service Worker do Painel registrado:', reg.scope))
      .catch(err => console.error('Erro ao registrar Service Worker do Painel:', err));
  }

  // Hide loader after a simulated 1.2s delay for premium entry feel
  setTimeout(() => {
    const loader = document.getElementById('loader');
    loader.classList.add('hidden');
  }, 1200);

  // Always start at the access portal. Saved data is used only to prefill the selected profile.
  const savedProfile = localStorage.getItem('loggedInProfile');
  switchLoginTab(savedProfile && mockData.credentials[savedProfile] ? savedProfile : 'owner');
  
  // Set Date display in header
  const options = { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('current-date-span').innerText = new Date().toLocaleDateString('pt-BR', options);

  // Initialize lucide icons
  lucide.createIcons();

  // Listen to payment method changes in order request form to toggle change input
  const paymentSelect = document.getElementById('payment-method');
  if (paymentSelect) {
    paymentSelect.addEventListener('change', (e) => {
      const changeGroup = document.getElementById('change-group');
      if (e.target.value === 'dinheiro') {
        changeGroup.style.display = 'flex';
      } else {
        changeGroup.style.display = 'none';
      }
    });
  }

  // Sidebar mobile drawer logic
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.querySelector('.sidebar');
  let overlay = document.getElementById('sidebar-overlay');
  
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }
  
  function openMobileSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('active');
  }
  
  function closeMobileSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  }
  
  if (toggleBtn) {
    toggleBtn.addEventListener('click', openMobileSidebar);
  }
  const topbarLogo = document.getElementById('topbar-logo');
  if (topbarLogo) {
    topbarLogo.addEventListener('click', openMobileSidebar);
  }
  if (overlay) {
    overlay.addEventListener('click', closeMobileSidebar);
  }
  
  // Close sidebar on clicking navigation items on mobile
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        closeMobileSidebar();
      }
    });
  });

  // Close sidebar on clicking logout on mobile
  const logoutBtn = document.querySelector('.btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        closeMobileSidebar();
      }
    });
  }
});

// Profile switching inside Landing Login Card
function switchLoginTab(profile) {
  mockData.activeProfile = profile;
  
  // Update UI active state of buttons
  document.querySelectorAll('.login-tabs .tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`.login-tabs .tab-btn[data-tab="${profile}"]`).classList.add('active');

  // Set default values based on profile selection
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const usernameLabel = document.getElementById('username-label');
  const passwordGroup = document.getElementById('password-group');

  const profileCreds = mockData.credentials[profile];
  
  if (profile === 'order') {
    usernameLabel.innerText = 'E-mail do Comércio';
    usernameInput.type = 'email';
    usernameInput.value = profileCreds.email;
    usernameInput.placeholder = 'estabelecimento@email.com';
    passwordInput.value = profileCreds.pass;
    passwordGroup.style.display = 'flex';
  } else if (profile === 'client') {
    usernameLabel.innerText = 'E-mail do Cliente (Lancheria)';
    usernameInput.type = 'email';
    usernameInput.value = profileCreds.email;
    usernameInput.placeholder = 'estabelecimento@email.com';
    passwordInput.value = profileCreds.pass;
    passwordGroup.style.display = 'flex';
  } else {
    usernameLabel.innerText = 'E-mail do Administrador';
    usernameInput.type = 'email';
    usernameInput.value = profileCreds.email;
    usernameInput.placeholder = 'admin@garradelivery.com.br';
    passwordInput.value = profileCreds.pass;
    passwordGroup.style.display = 'flex';
  }
}

// Handle Login submit
function handleLogin(event) {
  if (event) event.preventDefault();
  
  // Show loader briefly to simulate validation
  const loader = document.getElementById('loader');
  loader.classList.remove('hidden');

  setTimeout(() => {
    loader.classList.add('hidden');
    loginSuccess();
  }, 800);
}

// Direct quick login demo trigger
function loginDemo() {
  handleLogin(null);
}

// Successful login flow setup
async function loginSuccess() {
  const profile = mockData.activeProfile;
  const creds = mockData.credentials[profile];

  const rememberInput = document.querySelector('.remember-me input');
  if (rememberInput && rememberInput.checked) {
    localStorage.setItem('loggedInProfile', profile);
  } else {
    localStorage.removeItem('loggedInProfile');
  }

  // Set Profile info in sidebar
  document.getElementById('user-avatar').src = creds.avatar;
  document.getElementById('user-display-name').innerText = creds.name;
  document.getElementById('user-display-sub').innerText = creds.role;

  // Toggle visible sidebar navigation items depending on role
  document.getElementById('nav-owner-group').classList.add('hidden');
  document.getElementById('nav-client-group').classList.add('hidden');
  document.getElementById('nav-order-group').classList.add('hidden');

  // Route to the appropriate view/dashboard tab
  document.getElementById('view-landing').classList.remove('active');
  document.getElementById('view-dashboard').classList.add('active');

  if (profile === 'owner') {
    document.getElementById('display-role').innerText = 'Painel do Dono';
    document.getElementById('nav-owner-group').classList.remove('hidden');
    document.getElementById('dashboard-title').innerText = 'Painel de Logística Garra';
    document.getElementById('dashboard-subtitle').innerText = 'Acompanhe a atividade em tempo real de toda a empresa.';
    
    // Fetch initial owner data from Supabase
    await fetchFleet();
    await fetchPendingDeliveries();

    // Switch to first owner tab
    switchDashboardTab('owner-overview');
    
    // Subscribe to support realtime notifications immediately on login
    subscribeSupportRealtime();
    
    // Render Fleet table
    renderFleetTable();
  } else if (profile === 'client') {
    document.getElementById('display-role').innerText = 'Painel Cliente';
    document.getElementById('nav-client-group').classList.remove('hidden');
    document.getElementById('dashboard-title').innerText = 'Burger do Chef';
    document.getElementById('dashboard-subtitle').innerText = 'Métricas de desempenho e histórico de entregas da sua lancheria.';
    
    // Fetch initial client data from Supabase
    await fetchClientHistory();

    // Switch to first client tab
    switchDashboardTab('client-overview');
    
    // Subscribe to support realtime notifications immediately on login
    subscribeSupportRealtime();
    
    // Render History table
    renderClientHistoryTable();
  } else if (profile === 'order') {
    document.getElementById('display-role').innerText = 'Pedir Entregador';
    document.getElementById('nav-order-group').classList.remove('hidden');
    document.getElementById('dashboard-title').innerText = 'Solicitação Exclusiva';
    document.getElementById('dashboard-subtitle').innerText = 'Painel expresso de chamadas de motoboy sob demanda.';
    
    // Switch to first order tab
    switchDashboardTab('order-request');
  }

  // Recalculate icon SVGs in the dashboard
  lucide.createIcons();
}

// Handle Logout
function handleLogout() {
  const loader = document.getElementById('loader');
  loader.classList.remove('hidden');

  // Clear session from local storage
  localStorage.removeItem('loggedInProfile');

  // Remove active chat subscription if any
  if (supabaseClient && supportChatChannel) {
    supabaseClient.removeChannel(supportChatChannel);
    supportChatChannel = null;
  }
  activeChatClientEmail = null;
  activeChatClientName = null;

  // Reset delivery request map
  if (requestDeliveryMap) {
    requestDeliveryMap.remove();
    requestDeliveryMap = null;
  }
  requestDeliveryMarker = null;
  restaurantMarker = null;
  requestDeliveryRouteLine = null;

  setTimeout(() => {
    loader.classList.add('hidden');
    
    // Hide Dashboards & Show Landing
    document.getElementById('view-dashboard').classList.remove('active');
    document.getElementById('view-landing').classList.add('active');
    
    // Clear dynamic variables
    resetTrackedOrder();
  }, 600);
}

// Switching dashboard tab views
async function switchDashboardTab(targetTab) {
  // Update Sidebar active items
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const navItem = document.querySelector(`.sidebar-nav .nav-item[data-tab="${targetTab}"]`);
  if (navItem) {
    navItem.classList.add('active');
  }

  // Update Main Dashboard Views
  document.querySelectorAll('.dashboard-tab-content').forEach(view => {
    view.classList.remove('active');
  });

  const activeTabEl = document.getElementById(`tab-${targetTab}`);
  if (activeTabEl) {
    activeTabEl.classList.add('active');
  }

  // Trigger specific tab initializers (like charts render)
  if (targetTab === 'owner-overview') {
    initOwnerOverviewChart();
  } else if (targetTab === 'owner-fleet-map') {
    await fetchFleet();
    initOwnerFleetMap();
  } else if (targetTab === 'owner-teles') {
    await loadTelesManagement();
  } else if (targetTab === 'owner-fleet') {
    await fetchFleet();
    renderFleetTable();
  } else if (targetTab === 'owner-financials') {
    initOwnerFinancialChart();
  } else if (targetTab === 'owner-rider-payments') {
    await fetchFleet();
    await fetchClientHistory();
    renderRiderPayments();
  } else if (targetTab === 'owner-settings') {
    await fetchFleet();
    renderRiderSettings();
    renderRiderLimits();
  } else if (targetTab === 'owner-integracoes') {
    if (window.lucide) lucide.createIcons();
  } else if (targetTab === 'client-overview') {
    initClientOverviewChart();
  } else if (targetTab === 'client-history') {
    await fetchClientHistory();
    renderClientHistoryTable();
  } else if (targetTab === 'client-ratings') {
    renderClientRatings();
  } else if (targetTab === 'order-request') {
    initRequestDeliveryMap();
  } else if (targetTab === 'client-support') {
    const dot = document.getElementById('client-chat-dot');
    if (dot) dot.classList.add('hidden');
    await loadClientChatHistory();
    subscribeSupportRealtime();
    if (window.lucide) lucide.createIcons();
  } else if (targetTab === 'owner-support') {
    const dot = document.getElementById('admin-chat-dot');
    if (dot) dot.classList.add('hidden');
    await loadAdminChatChannels();
    subscribeSupportRealtime();
    if (window.lucide) lucide.createIcons();
  } else if (targetTab === 'download-app') {
    if (window.lucide) lucide.createIcons();
  }
}

/* ============================================================
   INTEGRAÇÕES (iFood / 99Food) — chamam as Edge Functions
   ============================================================ */
const FUNCTIONS_BASE = `${supabaseUrl}/functions/v1`;

// Chama uma Edge Function. Só manda Authorization (anon) + Content-Type.
// Tenta de novo algumas vezes por causa do "cold start" (primeira chamada demora).
async function invokeFn(nome, body = {}, tentativas = 3) {
  let ultimoErro = null;
  for (let i = 0; i < tentativas; i++) {
    try {
      const resp = await fetch(`${FUNCTIONS_BASE}/${nome}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify(body),
      });
      const txt = await resp.text();
      let data = {};
      try { data = txt ? JSON.parse(txt) : {}; } catch (_) { data = { raw: txt }; }
      if (!resp.ok || data.ok === false) {
        throw new Error(data.erro || data.raw || `HTTP ${resp.status}`);
      }
      return data;
    } catch (err) {
      ultimoErro = err;
      // espera curtinha antes de tentar de novo (cold start)
      if (i < tentativas - 1) await new Promise(r => setTimeout(r, 1200));
    }
  }
  throw ultimoErro || new Error('Falha na requisição');
}

async function gerarLink99food() {
  const btn = document.getElementById('btn-99food-gerar');
  const erroEl = document.getElementById('99food-erro');
  const wrapper = document.getElementById('99food-link-wrapper');
  const input = document.getElementById('99food-link-input');
  if (erroEl) { erroEl.classList.add('hidden'); erroEl.innerText = ''; }
  if (btn) { btn.disabled = true; btn.querySelector('span').innerText = 'Gerando…'; }
  try {
    const r = await invokeFn('food99-vincular', {});
    if (!r.url) throw new Error('O 99Food não retornou um link. Verifique o app no portal.');
    if (input) input.value = r.url;
    if (wrapper) wrapper.classList.remove('hidden');
  } catch (err) {
    if (erroEl) { erroEl.classList.remove('hidden'); erroEl.innerText = 'Erro: ' + (err.message || err); }
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector('span').innerText = 'Gerar link de conexão'; }
  }
}

function copiarLink99food() {
  const input = document.getElementById('99food-link-input');
  const btn = document.getElementById('btn-99food-copiar');
  if (!input || !input.value) return;
  navigator.clipboard.writeText(input.value).then(() => {
    if (btn) {
      btn.innerText = 'Copiado!';
      setTimeout(() => { btn.innerText = 'Copiar'; }, 2000);
    }
  });
}

async function configurar99food() {
  const btn = document.getElementById('btn-99food-config');
  const msg = document.getElementById('99food-setup-msg');
  const statusBadge = document.getElementById('status-99food');
  if (msg) { msg.classList.add('hidden'); msg.innerText = ''; }
  if (btn) { btn.disabled = true; btn.querySelector('span').innerText = 'Configurando…'; }
  try {
    const r = await invokeFn('food99-setup', {});
    const configuradas = (r.configuradas || []).filter(c => c.online && c.confirm).length;
    if (msg) {
      msg.classList.remove('hidden');
      if (!r.total) {
        msg.innerText = 'Nenhuma loja vinculada ainda. Envie o link e peça pra loja autorizar.';
      } else {
        msg.innerText = `Pronto! ${configuradas} loja(s) online com confirmação pelo sistema.`;
        if (statusBadge && configuradas > 0) {
          statusBadge.innerText = 'Conectada';
          statusBadge.style.background = 'rgba(16, 185, 129, 0.12)';
          statusBadge.style.color = '#10b981';
        }
      }
    }
  } catch (err) {
    if (msg) { msg.classList.remove('hidden'); msg.innerText = 'Erro: ' + (err.message || err); }
  } finally {
    if (btn) { btn.disabled = false; btn.querySelector('span').innerText = 'Configurar loja vinculada'; }
  }
}

async function loadTelesManagement() {
  setTelesLoadingState();

  try {
    await Promise.all([
      fetchPendingDeliveries(),
      fetchFleet(),
      fetchClientHistory()
    ]);
  } catch (err) {
    console.error('Erro ao carregar dados da Gestão de Teles:', err);
    showTelesLoadError();
    return;
  }

  renderPendingDeliveries();
  renderActiveDeliveries();
}

function setTelesLoadingState() {
  const pendingContainer = document.getElementById('pending-deliveries-container');
  const activeContainer = document.getElementById('active-deliveries-container');
  const pendingBadge = document.getElementById('pending-count-badge');
  const activeBadge = document.getElementById('active-count-badge');

  if (pendingBadge) pendingBadge.innerText = 'carregando...';
  if (activeBadge) activeBadge.innerText = 'carregando...';

  const loadingCard = `
    <div class="tele-state-card">
      <div class="tele-state-spinner"></div>
      <p>Carregando teles...</p>
    </div>
  `;

  if (pendingContainer) pendingContainer.innerHTML = loadingCard;
  if (activeContainer) activeContainer.innerHTML = loadingCard;
}

function showTelesLoadError() {
  const pendingContainer = document.getElementById('pending-deliveries-container');
  const activeContainer = document.getElementById('active-deliveries-container');
  const pendingBadge = document.getElementById('pending-count-badge');
  const activeBadge = document.getElementById('active-count-badge');

  if (pendingBadge) pendingBadge.innerText = 'erro';
  if (activeBadge) activeBadge.innerText = 'erro';

  const errorCard = `
    <div class="tele-state-card tele-state-error">
      <i data-lucide="alert-triangle"></i>
      <p>Não foi possível carregar as teles.</p>
      <button class="btn btn-secondary btn-sm" onclick="loadTelesManagement()">Tentar novamente</button>
    </div>
  `;

  if (pendingContainer) pendingContainer.innerHTML = errorCard;
  if (activeContainer) activeContainer.innerHTML = errorCard;
  lucide.createIcons();
}

// Render the owner fleet table with mock data
function renderFleetTable() {
  const tbody = document.getElementById('owner-fleet-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  mockData.fleet.forEach(rider => {
    const tr = document.createElement('tr');
    tr.className = 'clickable-row';
    tr.onclick = () => openRiderActions(rider.id);
    tr.innerHTML = `
      <td>
        <div class="user-profile">
          <div class="item-icon-avatar bg-yellow"><i data-lucide="bike" class="text-black"></i></div>
          <div>
            <strong>${escapeHtml(rider.name)}</strong>
            <p class="text-muted text-xs">${escapeHtml(rider.id)}</p>
          </div>
        </div>
      </td>
      <td>
        <strong>${escapeHtml(rider.vehicle)}</strong>
        <p class="text-muted">${escapeHtml(rider.plate)}</p>
      </td>
      <td><span class="status-indicator ${escapeHtml(rider.statusClass)}">${escapeHtml(rider.status)}</span></td>
      <td><strong>${escapeHtml(rider.delivery)}</strong></td>
      <td>
        <div class="perf-bar-group" style="width: 100px;">
          <div class="perf-bar-label"><span class="text-xs">${escapeHtml(rider.battery)}</span></div>
          <div class="perf-bar">
            <div class="perf-bar-fill ${parseInt(rider.battery) > 50 ? 'bg-green' : (parseInt(rider.battery) > 25 ? 'bg-yellow' : 'bg-blue')}" style="width: ${parseInt(rider.battery)}%"></div>
          </div>
        </div>
      </td>
      <td>
        <div class="courier-rating">
          <i data-lucide="star" class="fill-yellow text-yellow"></i> <strong>${rider.rating.toFixed(2)}</strong>
        </div>
      </td>
      <td>
        <button class="btn btn-secondary btn-sm icon-action-btn" onclick="event.stopPropagation(); openRiderActions('${rider.id}')" title="Ações do motoboy" aria-label="Ações do motoboy">
          <i data-lucide="settings"></i>
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function parseMoneyBR(value) {
  if (!value) return 0;
  return Number(String(value).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
}

function formatMoneyBR(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function getCurrentWeekRangeLabel() {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = { day: '2-digit', month: '2-digit' };
  return `${monday.toLocaleDateString('pt-BR', fmt)} a ${sunday.toLocaleDateString('pt-BR', fmt)}`;
}

function getCurrentWeekBounds() {
  const today = new Date();
  const day = today.getDay();
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() - ((day + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return { monday, sunday };
}

function parseOrderDate(dateText) {
  const raw = String(dateText || '').trim();
  const now = new Date();
  if (!raw || raw.startsWith('Hoje')) return now;
  if (raw.startsWith('Ontem')) {
    const d = new Date(now);
    d.setDate(now.getDate() - 1);
    return d;
  }
  const brDate = raw.match(/(\d{2})\/(\d{2})(?:\/(\d{4}))?/);
  if (brDate) {
    return new Date(Number(brDate[3] || now.getFullYear()), Number(brDate[2]) - 1, Number(brDate[1]));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}

function isOrderInCurrentWeek(order) {
  const { monday, sunday } = getCurrentWeekBounds();
  const orderDate = parseOrderDate(order.date);
  return orderDate >= monday && orderDate <= sunday;
}

function renderRiderPayments() {
  const tbody = document.getElementById('rider-payments-table-body');
  if (!tbody) return;

  const totals = new Map();
  mockData.fleet.forEach(rider => totals.set(rider.name, { rider, count: 0, total: 0 }));

  mockData.clientHistory
    .filter(order => order.status === 'Entregue' && isOrderInCurrentWeek(order))
    .forEach(order => {
      if (!totals.has(order.rider)) {
        totals.set(order.rider, { rider: { name: order.rider, id: '—' }, count: 0, total: 0 });
      }
      const item = totals.get(order.rider);
      item.count += 1;
      item.total += parseMoneyBR(order.price);
    });

  const rows = Array.from(totals.values()).sort((a, b) => b.total - a.total);
  const grandTotalGross = rows.reduce((sum, row) => sum + row.total, 0);
  const grandTotalNet = grandTotalGross * 0.90; // Apply 10% discount
  const totalEl = document.getElementById('rider-week-total');
  const rangeEl = document.getElementById('rider-week-range');
  if (totalEl) totalEl.innerText = formatMoneyBR(grandTotalNet);
  if (rangeEl) rangeEl.innerText = getCurrentWeekRangeLabel();

  tbody.innerHTML = rows.map(row => {
    const gross = row.total;
    const discount = gross * 0.10;
    const net = gross * 0.90;
    const avg = row.count ? gross / row.count : 0;
    
    return `
      <tr>
        <td>
          <strong>${escapeHtml(row.rider.name)}</strong>
          <p class="text-muted">${escapeHtml(row.rider.id) || '—'}</p>
        </td>
        <td>${row.count}</td>
        <td>${formatMoneyBR(gross)}</td>
        <td class="text-danger">- ${formatMoneyBR(discount)}</td>
        <td><strong class="text-yellow">${formatMoneyBR(net)}</strong></td>
        <td>${formatMoneyBR(avg)}</td>
        <td><span class="status-indicator ${net > 0 ? 'status-progress' : 'status-neutral'}">${net > 0 ? 'Programado para quarta' : 'Sem valor'}</span></td>
      </tr>
    `;
  }).join('');
}

// Render the rider configurations list in the settings tab
function renderRiderSettings() {
  const tbody = document.getElementById('rider-settings-table-body');
  if (!tbody) return;

  // Calculate and update stats counters
  const totalRiders = mockData.fleet.length;
  const bypassRiders = mockData.fleet.filter(r => r.bypassDistanceLimit).length;
  const ruleRiders = totalRiders - bypassRiders;

  const totalEl = document.getElementById('stats-total-riders');
  const ruleEl = document.getElementById('stats-rule-riders');
  const bypassEl = document.getElementById('stats-bypass-riders');

  if (totalEl) totalEl.innerText = totalRiders;
  if (ruleEl) ruleEl.innerText = ruleRiders;
  if (bypassEl) bypassEl.innerText = bypassRiders;

  // Filter riders if search query exists
  const searchInput = document.getElementById('rider-search-input');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filteredFleet = mockData.fleet.filter(rider => {
    if (!query) return true;
    const name = (rider.name || '').toLowerCase();
    const id = (rider.id || '').toLowerCase();
    const plate = (rider.plate || '').toLowerCase();
    return name.includes(query) || id.includes(query) || plate.includes(query);
  });

  if (filteredFleet.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted" style="padding: 20px;">Nenhum motoboy encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredFleet.map(rider => {
    const isChecked = rider.bypassDistanceLimit ? 'checked' : '';
    return `
      <tr>
        <td>
          <strong>${escapeHtml(rider.name)}</strong>
          <p class="text-muted">${escapeHtml(rider.id)}</p>
        </td>
        <td>
          <strong>${escapeHtml(rider.vehicle)}</strong>
          <p class="text-muted">${escapeHtml(rider.plate)}</p>
        </td>
        <td>
          <div class="switch-container">
            <label class="switch">
              <input type="checkbox" ${isChecked} onchange="toggleRiderDistanceLimit('${rider.id}', this.checked)">
              <span class="slider"></span>
            </label>
            <span class="switch-label-text">Liberar sem limites de distância</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // If accordion is expanded, update its height to fit-content
  const accordion = document.getElementById('geofencing-accordion');
  if (accordion && accordion.classList.contains('expanded')) {
    const collapseWrapper = accordion.querySelector('.accordion-collapse-wrapper');
    if (collapseWrapper) {
      collapseWrapper.style.maxHeight = 'fit-content';
    }
  }
}

async function toggleRiderDistanceLimit(riderId, isBypassed) {
  if (!supabaseClient) return;

  try {
    const { error } = await supabaseClient
      .from('fleet')
      .update({ bypass_distance_limit: isBypassed })
      .eq('id', riderId);

    if (error) throw error;

    // Update local state
    const localRider = mockData.fleet.find(r => r.id === riderId);
    if (localRider) {
      localRider.bypassDistanceLimit = isBypassed;
    }
    
    // Update stats and UI immediately
    renderRiderSettings();
  } catch (err) {
    console.error("Error toggling distance limit bypass:", err);
    alert("Erro ao salvar a configuração de distância no Supabase. Tente novamente.");
    // Re-render to revert toggle state visually
    renderRiderSettings();
  }
}

// Live search filter callback
function filterRiderSettings() {
  renderRiderSettings();
}

// Toggle Geofencing accordion panel open/close
function toggleGeofencingAccordion() {
  const accordion = document.getElementById('geofencing-accordion');
  if (!accordion) return;

  const chevron = accordion.querySelector('.accordion-chevron');
  const collapseWrapper = accordion.querySelector('.accordion-collapse-wrapper');

  const isExpanded = accordion.classList.toggle('expanded');

  if (isExpanded) {
    chevron.style.transform = 'rotate(180deg)';
    collapseWrapper.style.maxHeight = collapseWrapper.scrollHeight + 'px';
    setTimeout(() => {
      if (accordion.classList.contains('expanded')) {
        collapseWrapper.style.maxHeight = 'fit-content';
      }
    }, 250);
  } else {
    collapseWrapper.style.maxHeight = collapseWrapper.scrollHeight + 'px';
    collapseWrapper.offsetHeight; // force reflow
    chevron.style.transform = 'rotate(0deg)';
    collapseWrapper.style.maxHeight = '0';
  }
}

// Toggle Simultaneous Deliveries limit accordion panel open/close
function toggleSimultaneousDeliveriesAccordion() {
  const accordion = document.getElementById('simultaneous-deliveries-accordion');
  if (!accordion) return;

  const chevron = accordion.querySelector('.accordion-chevron');
  const collapseWrapper = accordion.querySelector('.accordion-collapse-wrapper');

  const isExpanded = accordion.classList.toggle('expanded');

  if (isExpanded) {
    chevron.style.transform = 'rotate(180deg)';
    collapseWrapper.style.maxHeight = collapseWrapper.scrollHeight + 'px';
    setTimeout(() => {
      if (accordion.classList.contains('expanded')) {
        collapseWrapper.style.maxHeight = 'fit-content';
      }
    }, 250);
  } else {
    collapseWrapper.style.maxHeight = collapseWrapper.scrollHeight + 'px';
    collapseWrapper.offsetHeight; // force reflow
    chevron.style.transform = 'rotate(0deg)';
    collapseWrapper.style.maxHeight = '0';
  }
}

// Render simultaneous deliveries limits list for each motoboy
function renderRiderLimits() {
  const tbody = document.getElementById('rider-limits-table-body');
  if (!tbody) return;

  // Calculate and update stats counters
  const totalRiders = mockData.fleet.length;
  const defaultRiders = mockData.fleet.filter(r => (r.maxSimultaneousDeliveries || 1) === 1).length;
  const customRiders = totalRiders - defaultRiders;

  const totalEl = document.getElementById('stats-limit-total-riders');
  const defaultEl = document.getElementById('stats-limit-default-riders');
  const customEl = document.getElementById('stats-limit-custom-riders');

  if (totalEl) totalEl.innerText = totalRiders;
  if (defaultEl) defaultEl.innerText = defaultRiders;
  if (customEl) customEl.innerText = customRiders;

  // Filter riders if search query exists
  const searchInput = document.getElementById('rider-limit-search-input');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const filteredFleet = mockData.fleet.filter(rider => {
    if (!query) return true;
    const name = (rider.name || '').toLowerCase();
    const id = (rider.id || '').toLowerCase();
    const plate = (rider.plate || '').toLowerCase();
    return name.includes(query) || id.includes(query) || plate.includes(query);
  });

  if (filteredFleet.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-center text-muted" style="padding: 20px;">Nenhum motoboy encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = filteredFleet.map(rider => {
    const currentLimit = rider.maxSimultaneousDeliveries || 1;
    return `
      <tr>
        <td>
          <strong>${escapeHtml(rider.name)}</strong>
          <p class="text-muted">${escapeHtml(rider.id)}</p>
        </td>
        <td>
          <strong>${escapeHtml(rider.vehicle)}</strong>
          <p class="text-muted">${escapeHtml(rider.plate)}</p>
        </td>
        <td>
          <select onchange="updateRiderDeliveryLimit('${rider.id}', this.value)" style="width: 100%; padding: 8px 12px; background: var(--input-bg); border: 1px solid var(--border-color); border-radius: var(--border-radius-sm); color: var(--color-text); font-size: 0.88rem; outline: none; transition: border-color 0.2s; cursor: pointer;">
            <option value="1" ${currentLimit === 1 ? 'selected' : ''}>1 entrega</option>
            <option value="2" ${currentLimit === 2 ? 'selected' : ''}>2 entregas</option>
            <option value="3" ${currentLimit === 3 ? 'selected' : ''}>3 entregas</option>
            <option value="4" ${currentLimit === 4 ? 'selected' : ''}>4 entregas</option>
            <option value="5" ${currentLimit === 5 ? 'selected' : ''}>5 entregas</option>
          </select>
        </td>
      </tr>
    `;
  }).join('');

  // If accordion is expanded, update its height to fit-content
  const accordion = document.getElementById('simultaneous-deliveries-accordion');
  if (accordion && accordion.classList.contains('expanded')) {
    const collapseWrapper = accordion.querySelector('.accordion-collapse-wrapper');
    if (collapseWrapper) {
      collapseWrapper.style.maxHeight = 'fit-content';
    }
  }
}

// Update a rider's simultaneous delivery limit in Supabase
async function updateRiderDeliveryLimit(riderId, limitValue) {
  const parsedLimit = parseInt(limitValue) || 1;

  if (!supabaseClient) {
    const rider = mockData.fleet.find(r => r.id === riderId);
    if (rider) rider.maxSimultaneousDeliveries = parsedLimit;
    renderRiderLimits();
    showToastNotification('Limite de entregas simultâneas atualizado com sucesso.');
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('fleet')
      .update({ max_simultaneous_deliveries: parsedLimit })
      .eq('id', riderId);

    if (error) throw error;

    const rider = mockData.fleet.find(r => r.id === riderId);
    if (rider) rider.maxSimultaneousDeliveries = parsedLimit;
    renderRiderLimits();
    showToastNotification('Limite de entregas simultâneas atualizado com sucesso.');
  } catch (err) {
    console.error("Error updating rider delivery limit:", err);
    alert("Erro ao atualizar o limite de entregas do motoboy no Supabase. Tente novamente.");
    renderRiderLimits();
  }
}

// Restore default simultaneous delivery limit (1) for ALL riders
async function restoreDefaultAllRiderLimits() {
  if (!confirm('Tem certeza de que deseja restaurar o limite padrão (1 entrega) para TODOS os motoboys?')) return;

  if (!supabaseClient) {
    mockData.fleet.forEach(rider => {
      rider.maxSimultaneousDeliveries = 1;
    });
    renderRiderLimits();
    showToastNotification('Todos os motoboys foram redefinidos para o limite padrão (1 entrega).');
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('fleet')
      .update({ max_simultaneous_deliveries: 1 });

    if (error) throw error;

    mockData.fleet.forEach(rider => {
      rider.maxSimultaneousDeliveries = 1;
    });
    renderRiderLimits();
    showToastNotification('Todos os motoboys foram redefinidos para o limite padrão (1 entrega).');
  } catch (err) {
    console.error("Error restoring all rider limits:", err);
    alert("Erro ao redefinir os limites no Supabase. Tente novamente.");
    renderRiderLimits();
  }
}

// Search filter callback for rider limits
function filterRiderLimits() {
  renderRiderLimits();
}

// Render the client delivery history table
function renderClientHistoryTable() {
  const tbody = document.getElementById('client-history-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  mockData.clientHistory.forEach(order => {
    const tr = document.createElement('tr');
    const isActive = order.status !== 'Entregue' && order.status !== 'Concluído';
    const statusHtml = `
      <div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
        <span class="status-indicator ${order.statusClass}">${order.status}</span>
        ${isActive ? `<button class="btn btn-secondary btn-sm" onclick="trackActiveOrder('${order.id}')" style="padding: 2px 8px; font-size: 0.75rem; cursor: pointer; border: 1px solid var(--border-color); background: var(--secondary); color: var(--color-text);">Rastrear</button>` : ''}
      </div>
    `;

    tr.innerHTML = `
      <td><strong>${order.id}</strong></td>
      <td>
        <strong>${order.destName}</strong>
        <p class="text-muted">${order.address}</p>
      </td>
      <td>${order.rider}</td>
      <td>${order.dist}</td>
      <td><strong class="text-yellow">${order.price}</strong></td>
      <td>${order.date}</td>
      <td>${statusHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// Generate next sequential TELE ID (#TELE-0001, #TELE-0002, ...)
async function getNextTeleId() {
  let maxNum = 0;
  if (supabaseClient) {
    const [{ data: pending }, { data: history }] = await Promise.all([
      supabaseClient.from('pending_deliveries').select('id'),
      supabaseClient.from('client_history').select('id')
    ]);
    [...(pending || []), ...(history || [])].forEach(item => {
      const match = (item.id || '').match(/#TELE-(\d+)/);
      if (match) maxNum = Math.max(maxNum, parseInt(match[1]));
    });
  }
  return '#TELE-' + String(maxNum + 1).padStart(4, '0');
}

// Calculate delivery price and distance on form inputs
function calculateEstimate() {
  const addressInput = document.getElementById('delivery-address').value;
  const estimateBox = document.getElementById('estimate-box');

  if (addressInput.length < 5) {
    estimateBox.classList.add('hidden');
    return;
  }

  // Seed standard generator based on address string length to keep values consistent while typing
  const seed = addressInput.length;
  const distance = parseFloat((1.5 + (seed % 10) * 1.2).toFixed(1)); // mock distance: 1.5km to 12.3km
  const minutes = Math.round(distance * 3.5 + 4); // mock speed minutes
  
  // Calculate price: Base R$ 7.90 + R$ 1.50 per km (rounded to 5 cents)
  let price = 7.90;
  if (distance > 2.0) {
    price += (distance - 2.0) * 1.50;
  }
  
  // Store values temporarily for form submission
  window.lastEstimate = {
    distance: distance + ' km',
    time: minutes + ' min',
    price: 'R$ ' + price.toFixed(2).replace('.', ',')
  };

  // Update UI values
  document.getElementById('est-distance').innerText = window.lastEstimate.distance;
  document.getElementById('est-time').innerText = window.lastEstimate.time;
  document.getElementById('est-price').innerText = window.lastEstimate.price;

  estimateBox.classList.remove('hidden');
}

// Submit delivery request and trigger live tracking simulation
async function submitDeliveryRequest(event) {
  event.preventDefault();

  const destAddress = document.getElementById('delivery-address').value;
  const cargoType = document.getElementById('cargo-type').value;
  const payMethod = document.getElementById('payment-method').value;
  const notes = document.getElementById('order-notes').value;

  if (!window.lastEstimate) return;

  // Generate sequential TELE ID
  const randomId = await getNextTeleId();
  
  // Format payment name
  const paymentStr = payMethod === 'pix' ? 'PIX (Pago pelo App)' : (payMethod === 'cartao-maquininha' ? 'Levar Maquininha' : 'Dinheiro (Troco para R$ ' + document.getElementById('change-amount').value + ')');
  // Format cargo name
  const cargoStr = cargoType === 'lanche' ? '🍔 Lanches e Bebidas' : (cargoType === 'pizza' ? '🍕 Pizza Família' : (cargoType === 'doce' ? '🍩 Doces e Sobremesas' : '📄 Papelada / Documentos'));

  let pickupLat = -23.55052;
  let pickupLng = -46.633308;
  if (restaurantMarker) {
    const latlng = restaurantMarker.getLatLng();
    pickupLat = latlng.lat;
    pickupLng = latlng.lng;
  } else if (Array.isArray(requestDeliveryCenterCoords)) {
    pickupLat = requestDeliveryCenterCoords[0];
    pickupLng = requestDeliveryCenterCoords[1];
  }

  let destLat = null;
  let destLng = null;
  if (requestDeliveryMarker) {
    const destLatLng = requestDeliveryMarker.getLatLng();
    destLat = destLatLng.lat;
    destLng = destLatLng.lng;
  }

  // Create delivery payload for Supabase
  const newDelivery = {
    id: randomId,
    client: 'Burger do Chef',
    dest_name: 'Cliente Express',
    address: destAddress,
    dist: window.lastEstimate.distance,
    price: window.lastEstimate.price,
    payment: paymentStr,
    cargo: cargoStr,
    pickup_lat: pickupLat,
    pickup_lng: pickupLng,
    dest_lat: destLat,
    dest_lng: destLng
  };

  // Insert to Supabase pending_deliveries table
  if (supabaseClient) {
    const { error } = await supabaseClient
      .from('pending_deliveries')
      .insert([newDelivery]);
    if (error) {
      console.error("Error inserting delivery to Supabase:", error);
      alert("Erro ao criar a solicitação de entrega no Supabase.");
      return;
    }
  }

  // Setup tracker UI elements
  const newOrder = {
    id: randomId,
    destName: 'Cliente Express',
    address: destAddress,
    rider: 'Carlos Oliveira (Demo)',
    dist: window.lastEstimate.distance,
    price: window.lastEstimate.price,
    date: 'Hoje, ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    status: 'Buscando Entregador',
    statusClass: 'status-progress'
  };

  // Add order to local mock state history
  mockData.clientHistory.unshift(newOrder);

  // Setup tracker UI elements
  document.getElementById('tracker-order-id').innerText = randomId;
  document.getElementById('tracker-badge-status').innerText = 'Buscando Entregador';
  document.getElementById('tracker-badge-status').className = 'status-badge status-warning';
  
  // Enable tracking tab
  const trackingTabBtn = document.getElementById('nav-tracking-tab');
  if (trackingTabBtn) {
    trackingTabBtn.disabled = false;
    trackingTabBtn.querySelector('.pulse-dot').classList.remove('hidden');
  }
  
  // Reset stepper nodes status
  document.querySelectorAll('.step-node').forEach(node => {
    node.className = 'step-node';
    node.querySelector('.text-muted').innerText = '--:--';
  });
  
  // Set first step active
  document.getElementById('step-1').className = 'step-node active';
  document.getElementById('step-1-time').innerText = 'Confirmado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Hide Courier Profile card inside tracker initially
  document.getElementById('tracker-courier-box').classList.add('hidden');

  // Switch view to tracking
  switchDashboardTab('order-tracking');

  // Trigger real-time logistics tracking
  startRealtimeTracking(newDelivery);

  // Reset Request Form
  document.getElementById('order-request-form').reset();
  document.getElementById('estimate-box').classList.add('hidden');
  window.lastEstimate = null;

  // Reset request map markers
  if (requestDeliveryMap) {
    if (requestDeliveryMarker) {
      requestDeliveryMap.removeLayer(requestDeliveryMarker);
      requestDeliveryMarker = null;
    }
    if (requestDeliveryRouteLine) {
      requestDeliveryMap.removeLayer(requestDeliveryRouteLine);
      requestDeliveryRouteLine = null;
    }
  }
}

// Reset tracking tab to disabled once finished or logged out
function resetTrackedOrder() {
  const trackingTabBtn = document.getElementById('nav-tracking-tab');
  if (trackingTabBtn) {
    trackingTabBtn.disabled = true;
    trackingTabBtn.querySelector('.pulse-dot').classList.add('hidden');
  }

  if (trackingRealtimeChannel) {
    if (supabaseClient) {
      supabaseClient.removeChannel(trackingRealtimeChannel);
    }
    trackingRealtimeChannel = null;
  }

  if (trackingMapInstance) {
    trackingMapInstance.remove();
    trackingMapInstance = null;
  }
}

// simulated tracking timeline sequence
function runLogisticsSimulation(order) {
  const trackerStatus = document.getElementById('tracker-badge-status');
  const moto = document.getElementById('map-moto');

  // Time configurations (shortened for preview experience)
  // Step 1: Assigning Courier (3 seconds)
  setTimeout(() => {
    trackerStatus.innerText = 'Entregador Coletando';
    trackerStatus.className = 'status-badge status-progress';

    // Highlight step 1 as complete, step 2 active
    document.getElementById('step-1').className = 'step-node completed';
    document.getElementById('step-2').className = 'step-node active';
    document.getElementById('step-2-time').innerText = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Show rider profile info
    document.getElementById('tracker-courier-box').classList.remove('hidden');

    // Move motorcycle icon to pickup location (Burger do Chef shop at top: 70%, left: 30%)
    moto.style.transition = 'top 5s cubic-bezier(0.25, 0.46, 0.45, 0.94), left 5s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    moto.style.top = '70%';
    moto.style.left = '30%';

  }, 3000);

  // Step 2: Rider arrived at merchant and picked up package (9 seconds total, wait 1s)
  setTimeout(() => {
    trackerStatus.innerText = 'Em Rota de Entrega';
    trackerStatus.className = 'status-badge status-progress';

    // Highlight step 2 as complete, step 3 active
    document.getElementById('step-2').className = 'step-node completed';
    document.getElementById('step-3').className = 'step-node active';
    document.getElementById('step-3-time').innerText = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Move motorcycle icon from pickup to customer delivery location (top: 25%, left: 75%)
    moto.style.transition = 'top 10s linear, left 10s linear';
    moto.style.top = '25%';
    moto.style.left = '75%';

  }, 9000);

  // Step 3: Rider arrived at client and handed order (20 seconds total)
  setTimeout(() => {
    trackerStatus.innerText = 'Concluído';
    trackerStatus.className = 'status-badge status-success';

    // Highlight step 3 as complete, step 4 active
    document.getElementById('step-3').className = 'step-node completed';
    document.getElementById('step-4').className = 'step-node active';
    document.getElementById('step-4-time').innerText = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    // Update simulation record in internal storage
    order.status = 'Entregue';
    order.statusClass = 'status-success';
    
    // Update total dashboard metrics for simulation
    const metricsValEl = document.getElementById('client-total-orders');
    if (metricsValEl) {
      let currentVal = parseInt(metricsValEl.innerText);
      metricsValEl.innerText = (currentVal + 1);
    }
    const metricsCostEl = document.getElementById('client-total-cost');
    if (metricsCostEl) {
      let currentCost = parseFloat(metricsCostEl.innerText.replace('R$ ', '').replace('.', '').replace(',', '.'));
      let extraPrice = parseFloat(order.price.replace('R$ ', '').replace('.', '').replace(',', '.'));
      metricsCostEl.innerText = 'R$ ' + (currentCost + extraPrice).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    // Clear tracking pulse
    document.getElementById('nav-tracking-tab').querySelector('.pulse-dot').classList.add('hidden');

  }, 20000);
  
  // Step 4: Fully finalize order tracker card states (23 seconds total)
  setTimeout(() => {
    document.getElementById('step-4').className = 'step-node completed';
  }, 23000);
}


/* ================= CHART INITIALIZATION ================= */

// Chart 1: Owner Overview deliveries
function initOwnerOverviewChart() {
  const ctx = document.getElementById('ownerOverviewChart');
  if (!ctx) return;

  if (ownerOverviewChart) {
    ownerOverviewChart.destroy();
  }

  ownerOverviewChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
      datasets: [{
        label: 'Entregas Concluídas',
        data: [1200, 1420, 1310, 1580, 1920, 1842, 1100],
        borderColor: '#ffb700',
        backgroundColor: 'rgba(255, 183, 0, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8e8e9f' }
        },
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8e8e9f' }
        }
      }
    }
  });
}

// Chart 2: Owner Financials doughnut
function initOwnerFinancialChart() {
  const ctx = document.getElementById('ownerFinancialChart');
  if (!ctx) return;

  if (ownerFinancialChart) {
    ownerFinancialChart.destroy();
  }

  ownerFinancialChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Repasse Motoboys', 'Comissão Garra', 'Seguros / Taxas'],
      datasets: [{
        data: [71, 24, 5],
        backgroundColor: ['#ffb700', '#f97316', '#10b981'],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#8e8e9f', font: { family: 'Inter', size: 12 } }
        }
      }
    }
  });
}

// Chart 3: Client Snack Bar performance comparison
function initClientOverviewChart() {
  const ctx = document.getElementById('clientOverviewChart');
  if (!ctx) return;

  if (clientOverviewChart) {
    clientOverviewChart.destroy();
  }

  clientOverviewChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
      datasets: [
        {
          label: 'Estimado (min)',
          data: [18, 18, 18, 20, 22, 22, 20],
          backgroundColor: 'rgba(255,255,255,0.1)',
          borderRadius: 4
        },
        {
          label: 'Tempo Real (min)',
          data: [16, 15, 17, 19, 21, 20, 18],
          backgroundColor: '#ffb700',
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#8e8e9f' }
        }
      },
      scales: {
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8e8e9f' }
        },
        x: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8e8e9f' }
        }
      }
    }
  });
}

// Map 1: Owner Fleet Monitoring Map
function initOwnerFleetMap() {
  const mapContainer = document.getElementById('owner-fleet-map');
  if (!mapContainer) return;

  // If map is already initialized, we just invalidate size to make sure it renders correctly
  if (ownerFleetMap) {
    setTimeout(() => {
      ownerFleetMap.invalidateSize();
    }, 100);
    return;
  }

  // Fallback central coordinates (São Paulo)
  let centerCoords = [-23.55052, -46.633308];

  // Create map instance
  ownerFleetMap = L.map('owner-fleet-map').setView(centerCoords, 14);

  // CartoDB Dark Matter tile layer for premium dark aesthetics
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20
  }).addTo(ownerFleetMap);

  // Try to fetch user geolocation
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        centerCoords = [position.coords.latitude, position.coords.longitude];
        ownerFleetMap.setView(centerCoords, 14);
        renderMapMarkers(centerCoords);
      },
      (error) => {
        console.warn("Geolocation failed or denied. Using fallback coordinates.", error);
        renderMapMarkers(centerCoords);
      }
    );
  } else {
    renderMapMarkers(centerCoords);
  }
}

// Render markers on the map relative to the center coordinate
function renderMapMarkers(centerCoords) {
  // Clear any existing markers (if any)
  ownerFleetMap.eachLayer((layer) => {
    if (layer instanceof L.Marker) {
      ownerFleetMap.removeLayer(layer);
    }
  });

  // 1. Add Owner/Central marker (You)
  const centralIconHtml = `
    <div class="custom-map-marker central-marker" style="background-color: #ffffff; box-shadow: 0 0 15px #ffffff; border-color: var(--primary);">
      <div class="marker-pulse" style="border-color: var(--primary); animation-duration: 2.5s;"></div>
      <i class="marker-icon-dot" style="background-color: var(--primary); width: 6px; height: 6px; border-radius: 50%; display: block;"></i>
    </div>
  `;
  const centralIcon = L.divIcon({
    html: centralIconHtml,
    className: 'custom-div-icon',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
  
  L.marker(centerCoords, { icon: centralIcon })
    .addTo(ownerFleetMap)
    .bindPopup(`
      <div class="map-popup-card">
        <h4 style="color: var(--color-text); margin: 0 0 4px 0; font-family: var(--font-display); font-weight: 700;">Sua Central</h4>
        <p style="margin: 0; font-size: 0.8rem; color: var(--color-text-muted);">Localização em tempo real</p>
      </div>
    `);

  // Offsets to distribute riders around the center coordinates
  const offsets = [
    [0.004, -0.006],
    [0.008, 0.012],
    [-0.005, 0.009],
    [-0.012, -0.004],
    [0.003, -0.015],
    [-0.009, 0.005]
  ];

  // Fallback demo riders when Supabase does not return fleet rows.
  const demoRidersLocations = [
    { name: 'Carlos Oliveira', vehicle: 'Honda CG 160 Fan', plate: 'ABC-1234', status: 'A caminho da coleta', statusColor: '#ffb700', offset: offsets[0] },
    { name: 'Marcos Santos', vehicle: 'Yamaha YZF-R3', plate: 'XYZ-9876', status: 'Em rota de entrega', statusColor: '#ffb700', offset: offsets[1] },
    { name: 'Julia Costa', vehicle: 'Shineray XY 50', plate: 'MNO-5432', status: 'Disponível', statusColor: '#f97316', offset: offsets[2] },
    { name: 'Roberto Lima', vehicle: 'Honda Biz 125', plate: 'PQR-8765', status: 'Em Descanso', statusColor: '#8e8e9f', offset: offsets[3] },
    { name: 'Aline Dias', vehicle: 'Voltz EVS (Elétrica)', plate: 'ELE-2026', status: 'Em rota de entrega', statusColor: '#ffb700', offset: offsets[4] },
    { name: 'Lucas Souza', vehicle: 'Yamaha Fazer 250', plate: 'DEF-4321', status: 'Disponível', statusColor: '#f97316', offset: offsets[5] }
  ];
  const ridersLocations = mockData.fleet.length
    ? mockData.fleet.map((rider, index) => ({
        id: rider.id,
        name: rider.name,
        vehicle: rider.vehicle,
        plate: rider.plate,
        status: rider.status,
        statusColor: rider.status === 'Em Descanso' ? '#8e8e9f' : (rider.statusClass === 'status-progress' ? '#ffb700' : '#f97316'),
        offset: offsets[index % offsets.length]
      }))
    : demoRidersLocations;

  // Add markers to map
  ridersLocations.forEach(rider => {
    // Find matching rider details in mockData.fleet to make sure status is accurate
    const mockRider = mockData.fleet.find(r => r.name === rider.name);
    const currentStatus = mockRider ? mockRider.status : rider.status;
    const currentStatusColor = mockRider 
      ? (mockRider.status === 'Em Descanso' ? '#8e8e9f' : (mockRider.statusClass === 'status-progress' ? '#ffb700' : '#f97316')) 
      : rider.statusColor;

    const riderCoords = [centerCoords[0] + rider.offset[0], centerCoords[1] + rider.offset[1]];
    const isPulsing = currentStatus !== 'Em Descanso';
    const markerHtml = `
      <div class="custom-map-marker" style="background-color: ${currentStatusColor}; box-shadow: 0 0 10px ${currentStatusColor};">
        ${isPulsing ? `<div class="marker-pulse" style="border-color: ${currentStatusColor};"></div>` : ''}
        <i class="marker-icon-dot"></i>
      </div>
    `;

    const customIcon = L.divIcon({
      html: markerHtml,
      className: 'custom-div-icon',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const marker = L.marker(riderCoords, { icon: customIcon }).addTo(ownerFleetMap);

    // Generate pending deliveries options for popup dropdown
    let dispatchHtml = '';
    if (currentStatus !== 'Em Descanso') {
      if (mockData.pendingDeliveries.length > 0) {
        const deliveryOptions = mockData.pendingDeliveries
          .map(d => `<option value="${d.id}">${d.id} - ${d.client} (${d.dist})</option>`)
          .join('');

        const riderIdSafe = mockRider ? mockRider.id.replace('#', '') : rider.name.replace(/\W/g, '');

        dispatchHtml = `
          <div class="map-popup-dispatch">
            <label>Enviar tele para este motoboy</label>
            <select id="popup-select-delivery-${riderIdSafe}" class="map-popup-select">
                <option value="" disabled selected>Escolha a tele...</option>
                ${deliveryOptions}
            </select>
            <div class="map-popup-actions">
              <button class="map-popup-send-btn" onclick="handlePopupDispatch('${escapeHtml(rider.name)}')">
                <i data-lucide="send"></i>
                <span>Enviar</span>
              </button>
              ${mockRider ? `
                <button class="map-popup-remove-btn" onclick="openRemoveTeleModal('${mockRider.id}')">Remover tele</button>
                <button class="map-popup-settings-btn" onclick="openRiderActions('${mockRider.id}')" title="Funções do motoboy" aria-label="Funções do motoboy">
                  <i data-lucide="settings"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `;
      } else {
        dispatchHtml = `
          <div class="map-popup-dispatch map-popup-empty-actions">
            <span>Nenhuma tele pendente.</span>
            ${mockRider ? `
              <div class="map-popup-actions">
                <button class="map-popup-remove-btn" onclick="openRemoveTeleModal('${mockRider.id}')">Remover tele</button>
                <button class="map-popup-settings-btn" onclick="openRiderActions('${mockRider.id}')" title="Funções do motoboy" aria-label="Funções do motoboy">
                  <i data-lucide="settings"></i>
                </button>
              </div>
            ` : ''}
          </div>
        `;
      }
    }

    // Popup custom content
    const popupContent = `
      <div class="map-popup-card">
        <h4>${escapeHtml(rider.name)}</h4>
        <p>${escapeHtml(rider.vehicle)} • <strong>${escapeHtml(rider.plate)}</strong></p>
        <span class="status-indicator" style="display: inline-block; padding: 2px 8px; font-size: 0.7rem; border-radius: 10px; font-weight: 600; color: ${currentStatusColor === '#8e8e9f' ? 'var(--color-text-muted)' : (currentStatusColor === '#ffb700' ? 'var(--primary)' : 'var(--accent-cyan)')}; background: ${currentStatusColor === '#8e8e9f' ? 'rgba(142, 142, 159, 0.15)' : (currentStatusColor === '#ffb700' ? 'var(--primary-glow)' : 'var(--accent-cyan-glow)')};">${escapeHtml(currentStatus)}</span>
        ${dispatchHtml}
      </div>
    `;

    marker.bindPopup(popupContent);
    marker.on('popupopen', () => lucide.createIcons());
    if (mockRider && selectedMapRiderId === mockRider.id) {
      ownerFleetMap.setView(riderCoords, 16);
      setTimeout(() => marker.openPopup(), 150);
    }
  });
}

// Render pending deliveries (dispatch system) cards
function renderPendingDeliveries() {
  const container = document.getElementById('pending-deliveries-container');
  if (!container) return;

  const pendingBadge = document.getElementById('pending-count-badge');
  if (pendingBadge) pendingBadge.innerText = mockData.pendingDeliveries.length + ' pendentes';

  if (mockData.pendingDeliveries.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background-color: var(--bg-card); border: 1px dashed var(--border-color); border-radius: var(--border-radius-md); color: var(--color-text-muted);">
        <i data-lucide="check-circle" style="width: 48px; height: 48px; color: var(--success); margin-bottom: 12px; display: inline-block;"></i>
        <p style="font-weight: 600; color: var(--color-text);">Tudo em ordem!</p>
        <p style="font-size: 0.9rem;">Nenhuma tele pendente de despacho no momento.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = '';
  mockData.pendingDeliveries.forEach(delivery => {
    // Generate active riders list options for dropdown
    const activeRidersOptions = mockData.fleet
      .filter(rider => rider.status !== 'Em Descanso')
      .map(rider => `<option value="${escapeHtml(rider.id)}">${escapeHtml(rider.name)} (${escapeHtml(rider.status)})</option>`)
      .join('');

    const card = document.createElement('div');
    card.className = 'pending-card';
    card.innerHTML = `
      <div class="pending-card-header">
        <strong style="font-family: var(--font-display);">${delivery.id}</strong>
        <span class="badge badge-warning" style="background: var(--primary-glow); color: var(--primary);">${delivery.client}</span>
      </div>
      <div class="pending-card-body">
        <p><strong>Destino:</strong> ${delivery.destName}</p>
        <p class="text-muted text-xs" style="margin-top: 4px; display: flex; align-items: center; gap: 4px;"><i data-lucide="map-pin" style="width: 12px; height: 12px;"></i> ${delivery.address}</p>
        <p style="margin-top: 6px;"><strong>Mercadoria:</strong> ${delivery.cargo}</p>
        <p><strong>Valor:</strong> <span class="text-yellow" style="color: var(--primary) !important;">${delivery.price}</span> (${delivery.payment})</p>
      </div>
      <div class="pending-card-footer" style="display: flex; gap: 8px; align-items: flex-end; margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 12px;">
        <div class="form-group flex-1" style="margin-bottom: 0;">
          <label style="font-size: 0.75rem; margin-bottom: 4px; display: block; color: var(--color-text-muted);">Enviar para:</label>
          <div class="input-wrapper" style="width: 100%;">
            <select id="select-rider-${delivery.id.replace('#', '')}" style="background-color: var(--bg-input); border: 1px solid var(--border-color); color: var(--color-text); padding: 8px 10px; font-size: 0.8rem; border-radius: 4px; width: 100%; outline: none; appearance: none; cursor: pointer;">
              <option value="" disabled selected>Selecionar Motoboy</option>
              ${activeRidersOptions}
            </select>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="handleDispatchClick('${delivery.id}')" style="padding: 8px 12px; font-size: 0.8rem; border-radius: 4px; height: 33px; min-width: 40px; display: flex; justify-content: center; align-items: center;">
          <i data-lucide="send"></i>
        </button>
      </div>
    `;
    container.appendChild(card);
  });
  lucide.createIcons();
}

// Wrapper function to dispatch from lists button click
window.handleDispatchClick = function(deliveryId) {
  const safeId = deliveryId.replace('#', '');
  const select = document.getElementById(`select-rider-${safeId}`);
  if (!select || !select.value) {
    alert("Por favor, selecione um motoboy para enviar esta tele!");
    return;
  }
  dispatchDelivery(deliveryId, select.value);
};

// Global handler for popup dispatch
window.handlePopupDispatch = function(riderName) {
  // Find rider by name to get ID
  const rider = mockData.fleet.find(r => r.name === riderName);
  if (!rider) return;

  const select = document.getElementById(`popup-select-delivery-${rider.id.replace('#', '')}`);
  if (!select || !select.value) {
    alert("Por favor, selecione uma entrega para enviar!");
    return;
  }

  // Close map popups before dispatching
  if (ownerFleetMap) {
    ownerFleetMap.closePopup();
  }

  dispatchDelivery(select.value, rider.id);
};

// Dispatch delivery function
async function dispatchDelivery(deliveryId, riderId) {
  // Find delivery
  const deliveryIndex = mockData.pendingDeliveries.findIndex(d => d.id === deliveryId);
  if (deliveryIndex === -1) return;
  const delivery = mockData.pendingDeliveries[deliveryIndex];

  // Find rider
  const rider = mockData.fleet.find(r => r.id === riderId);
  if (!rider) return;

  if (supabaseClient) {
    // 1. Update rider status and delivery in fleet table
    const { error: fleetError } = await supabaseClient
      .from('fleet')
      .update({
        status: 'A caminho da coleta',
        status_class: 'status-progress',
        delivery: deliveryId
      })
      .eq('id', riderId);

    if (fleetError) {
      console.error("Error updating rider status on Supabase:", fleetError);
      alert("Erro ao atualizar o status do motoboy no Supabase.");
      return;
    }

    // 2. Delete delivery from pending_deliveries table
    const { error: deleteError } = await supabaseClient
      .from('pending_deliveries')
      .delete()
      .eq('id', deliveryId);

    if (deleteError) {
      console.error("Error deleting pending delivery on Supabase:", deleteError);
      alert("Erro ao remover a tele das pendências no Supabase.");
      return;
    }

    // 3. Add order details into client_history table
    const newHistoryItem = {
      id: deliveryId,
      dest_name: delivery.destName,
      address: delivery.address,
      rider: rider.name,
      dist: delivery.dist,
      price: delivery.price,
      date: 'Hoje, ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      status: 'A caminho da coleta',
      status_class: 'status-progress'
    };

    const { error: historyError } = await supabaseClient
      .from('client_history')
      .insert([newHistoryItem]);

    if (historyError) {
      console.error("Error inserting delivery history on Supabase:", historyError);
      alert("Erro ao salvar o histórico de entrega no Supabase.");
      return;
    }
  }

  // Refresh all state arrays from Supabase
  await fetchPendingDeliveries();
  await fetchFleet();
  await fetchClientHistory();

  // Re-render components
  renderPendingDeliveries();
  renderActiveDeliveries();
  renderFleetTable();
  renderClientHistoryTable();

  // Get current active map coordinates (from geolocation or fallback)
  // Re-render the map markers to show the updated status
  if (ownerFleetMap) {
    const center = ownerFleetMap.getCenter();
    renderMapMarkers([center.lat, center.lng]);
  }

  // Display Premium Alert/Notification
  showToastNotification(`Tele ${deliveryId} enviada com sucesso para ${rider.name}!`);
}

// Render active deliveries (deliveries currently with riders)
function renderActiveDeliveries() {
  const container = document.getElementById('active-deliveries-container');
  if (!container) return;

  // Find active deliveries in mockData.clientHistory (status is not 'Entregue')
  const activeOrders = mockData.clientHistory.filter(order => order.status !== 'Entregue');

  const activeBadge = document.getElementById('active-count-badge');
  if (activeBadge) activeBadge.innerText = activeOrders.length + ' em rota';

  if (activeOrders.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; background-color: var(--bg-card); border: 1px dashed var(--border-color); border-radius: var(--border-radius-md); color: var(--color-text-muted);">
        <i data-lucide="check-circle" style="width: 48px; height: 48px; color: var(--color-text-muted); margin-bottom: 12px; display: inline-block;"></i>
        <p style="font-weight: 600; color: var(--color-text);">Nenhuma tele em trânsito</p>
        <p style="font-size: 0.9rem;">Todos os motoboys estão aguardando despacho.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = '';
  activeOrders.forEach(order => {
    const card = document.createElement('div');
    card.className = 'active-card';
    card.innerHTML = `
      <div class="active-card-header">
        <strong style="font-family: var(--font-display);">${order.id}</strong>
        <span class="badge badge-success" style="background: var(--accent-cyan-glow); color: var(--accent-cyan); border-color: rgba(0, 174, 239, 0.2);">${order.rider}</span>
      </div>
      <div class="active-card-body">
        <p><strong>Destino:</strong> ${order.destName}</p>
        <p class="text-muted text-xs" style="margin-top: 4px; display: flex; align-items: center; gap: 4px;"><i data-lucide="map-pin" style="width: 12px; height: 12px;"></i> ${order.address}</p>
        <p style="margin-top: 6px;"><strong>Distância:</strong> ${order.dist} • <strong>Taxa:</strong> ${order.price}</p>
        <p style="margin-top: 4px;"><strong>Status:</strong> <span class="status-indicator ${order.statusClass}">${order.status}</span></p>
      </div>
      <div class="active-card-footer" style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 12px;">
        <button class="btn btn-secondary btn-sm" onclick="handleCompleteClick('${order.id}', '${order.rider}')" style="padding: 6px 12px; font-size: 0.8rem; border-radius: 4px; height: 30px; cursor: pointer; display: flex; align-items: center; gap: 6px; background-color: var(--secondary); color: var(--color-text); border: 1px solid var(--border-color);">
          <i data-lucide="check-circle" style="width: 14px; height: 14px; color: var(--success);"></i> Concluir Entrega
        </button>
      </div>
    `;
    container.appendChild(card);
  });
  lucide.createIcons();
}

// Complete delivery function
async function completeDelivery(deliveryId, riderName) {
  if (supabaseClient) {
    // 1. Update delivery status to Entregue in client_history table
    const { error: historyError } = await supabaseClient
      .from('client_history')
      .update({
        status: 'Entregue',
        status_class: 'status-success'
      })
      .eq('id', deliveryId);

    if (historyError) {
      console.error("Error completing delivery in client history on Supabase:", historyError);
      alert("Erro ao atualizar o histórico de entrega no Supabase.");
      return;
    }

    // 2. Find rider and update status to Disponivel and clear delivery
    const { error: fleetError } = await supabaseClient
      .from('fleet')
      .update({
        status: 'Disponível',
        status_class: 'status-success',
        delivery: 'Nenhuma'
      })
      .eq('name', riderName);

    if (fleetError) {
      console.error("Error resetting rider status on Supabase:", fleetError);
      alert("Erro ao liberar o motoboy no Supabase.");
      return;
    }
  }

  // Refresh all state arrays from Supabase
  await fetchPendingDeliveries();
  await fetchFleet();
  await fetchClientHistory();

  // Re-render components
  renderPendingDeliveries();
  renderActiveDeliveries();
  renderFleetTable();
  renderClientHistoryTable();

  // Re-render map markers
  if (ownerFleetMap) {
    const center = ownerFleetMap.getCenter();
    renderMapMarkers([center.lat, center.lng]);
  }

  // Display toast notification
  showToastNotification(`Tele ${deliveryId} concluída e entregue!`);
}

// Global click handler wrapper
window.handleCompleteClick = function(deliveryId, riderName) {
  if (confirm(`Deseja concluir e finalizar a entrega ${deliveryId} realizada por ${riderName}?`)) {
    completeDelivery(deliveryId, riderName);
  }
};

/* ================= CREDENTIAL CARD ================= */

// Armazena as credenciais abertas no momento
let _currentCreds = { id: '', name: '', pin: '' };
let _pinVisible = false;

function openCredentialCard(id, name, pin) {
  _currentCreds = { id, name, pin };
  _pinVisible = false;

  document.getElementById('cred-name').innerText = name;
  document.getElementById('cred-id').innerText = id;
  document.getElementById('cred-pin').innerText = '••••';

  const toggleBtn = document.getElementById('pin-toggle-btn');
  if (toggleBtn) toggleBtn.innerHTML = '<i data-lucide="eye"></i>';

  document.getElementById('modal-credentials').classList.remove('hidden');
  lucide.createIcons();
}

function closeCredentials(event) {
  if (event && event.target !== document.getElementById('modal-credentials')) return;
  document.getElementById('modal-credentials').classList.add('hidden');
}

function togglePinVisibility() {
  _pinVisible = !_pinVisible;
  const pinEl = document.getElementById('cred-pin');
  const toggleBtn = document.getElementById('pin-toggle-btn');
  pinEl.innerText = _pinVisible ? _currentCreds.pin : '••••';
  toggleBtn.innerHTML = _pinVisible
    ? '<i data-lucide="eye-off"></i>'
    : '<i data-lucide="eye"></i>';
  lucide.createIcons();
}

function copyCredentials() {
  const text = `Garra Delivery — Acesso Motoboy\nNome: ${_currentCreds.name}\nID: ${_currentCreds.id}\nPIN: ${_currentCreds.pin}\nAcesso: https://garradelivery.guigui-couto23.workers.dev/motoboy.html`;
  navigator.clipboard.writeText(text).then(() => {
    showToastNotification('Credenciais copiadas!');
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToastNotification('Credenciais copiadas!');
  });
}

function shareWhatsApp() {
  const text = encodeURIComponent(
    `*Garra Delivery — Seu Acesso*\n\nOlá, ${_currentCreds.name}! Suas credenciais de acesso ao app de motoboy são:\n\n*ID:* ${_currentCreds.id}\n*PIN:* ${_currentCreds.pin}\n\n*Link:* https://garradelivery.guigui-couto23.workers.dev/motoboy.html\n\n_Não compartilhe seu PIN com ninguém._`
  );
  window.open(`https://wa.me/?text=${text}`, '_blank');
}

// Mostra credenciais de um motoboy já cadastrado
function viewRiderCredentials(riderId) {
  const rider = mockData.fleet.find(r => r.id === riderId);
  if (!rider) return;
  openCredentialCard(rider.id, rider.name, rider.pin || '(sem PIN)');
}

function getActiveOrdersForRider(rider) {
  if (!rider) return [];
  return mockData.clientHistory.filter(order => order.rider === rider.name && order.status !== 'Entregue' && order.status !== 'Removida');
}

function openRemoveTeleModal(riderId) {
  const rider = mockData.fleet.find(r => r.id === riderId);
  if (!rider) return;

  selectedRiderId = riderId;
  const modal = document.getElementById('modal-remove-tele');
  const list = document.getElementById('remove-tele-list');
  const label = document.getElementById('remove-tele-rider-label');
  const orders = getActiveOrdersForRider(rider);

  label.innerText = orders.length
    ? `Teles ativas de ${rider.name}. Escolha qual remover.`
    : `${rider.name} não possui tele ativa no momento.`;

  list.innerHTML = orders.length ? orders.map(order => `
    <div class="list-item">
      <div class="item-info">
        <div class="item-icon-avatar bg-yellow"><i data-lucide="route" class="text-black"></i></div>
        <div>
          <h4>${order.id}</h4>
          <p class="text-muted">${order.address}</p>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="removeTeleFromRider('${order.id}', '${rider.id}')">
        <i data-lucide="list-x"></i> Remover
      </button>
    </div>
  `).join('') : `
    <div style="text-align: center; padding: 28px; color: var(--color-text-muted);">
      <i data-lucide="check-circle" style="width: 36px; height: 36px; color: var(--success); margin-bottom: 8px;"></i>
      <p>Nenhuma tele para remover.</p>
    </div>
  `;

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeRemoveTeleModal(event) {
  const modal = document.getElementById('modal-remove-tele');
  if (event && event.target !== modal) return;
  modal.classList.add('hidden');
}

async function removeTeleFromRider(deliveryId, riderId) {
  const rider = mockData.fleet.find(r => r.id === riderId);
  const order = mockData.clientHistory.find(item => item.id === deliveryId);
  if (!rider || !order) return;

  if (!confirm(`Remover a tele ${deliveryId} de ${rider.name} e devolver para pendentes?`)) return;

  const pendingPayload = {
    id: order.id,
    client: 'Burger do Chef',
    dest_name: order.destName || 'Cliente Express',
    address: order.address,
    dist: order.dist,
    price: order.price,
    payment: 'A combinar',
    cargo: 'Pedido'
  };

  if (supabaseClient) {
    const { error: pendingError } = await supabaseClient
      .from('pending_deliveries')
      .upsert([pendingPayload]);
    if (pendingError) {
      alert('Erro ao devolver a tele para pendentes.');
      return;
    }

    const { error: historyError } = await supabaseClient
      .from('client_history')
      .delete()
      .eq('id', deliveryId);
    if (historyError) {
      alert('Erro ao remover a tele do histórico ativo.');
      return;
    }

    const remainingOrders = getActiveOrdersForRider(rider).filter(item => item.id !== deliveryId);
    if (remainingOrders.length === 0) {
      await supabaseClient
        .from('fleet')
        .update({ status: 'Disponível', status_class: 'status-success', delivery: 'Nenhuma' })
        .eq('id', riderId);
    }
  }

  await fetchPendingDeliveries();
  await fetchFleet();
  await fetchClientHistory();
  renderPendingDeliveries();
  renderActiveDeliveries();
  renderFleetTable();
  renderRiderPayments();

  if (ownerFleetMap) {
    const center = ownerFleetMap.getCenter();
    renderMapMarkers([center.lat, center.lng]);
  }

  closeRemoveTeleModal();
  showToastNotification(`Tele ${deliveryId} removida de ${rider.name}.`);
}

function openRiderActions(riderId) {
  const rider = mockData.fleet.find(r => r.id === riderId);
  if (!rider) return;

  selectedRiderId = riderId;
  document.getElementById('rider-action-name').innerText = rider.name;
  document.getElementById('rider-action-id').innerText = rider.id;
  document.getElementById('rider-action-status').innerText = rider.status;
  document.getElementById('modal-rider-actions').classList.remove('hidden');
  lucide.createIcons();
}

function closeRiderActions(event) {
  const modal = document.getElementById('modal-rider-actions');
  if (event && event.target !== modal) return;
  modal.classList.add('hidden');
}

function locateSelectedRider() {
  if (!selectedRiderId) return;
  selectedMapRiderId = selectedRiderId;
  closeRiderActions();
  switchDashboardTab('owner-fleet-map');
}

function openCredentialsForSelectedRider() {
  if (!selectedRiderId) return;
  closeRiderActions();
  viewRiderCredentials(selectedRiderId);
}

function openRemoveTeleForSelectedRider() {
  if (!selectedRiderId) return;
  closeRiderActions();
  openRemoveTeleModal(selectedRiderId);
}

function openEditSelectedRider() {
  if (!selectedRiderId) return;
  const rider = mockData.fleet.find(r => r.id === selectedRiderId);
  if (!rider) return;

  document.getElementById('edit-rider-id').value = rider.id;
  document.getElementById('edit-rider-name').value = rider.name || '';
  document.getElementById('edit-rider-pin').value = rider.pin || '';
  document.getElementById('edit-rider-vehicle').value = rider.vehicle || '';
  document.getElementById('edit-rider-plate').value = rider.plate || '';
  document.getElementById('edit-rider-status').value = rider.status || 'Disponível';
  document.getElementById('edit-rider-battery').value = rider.battery || '';
  closeRiderActions();
  document.getElementById('modal-edit-rider').classList.remove('hidden');
  lucide.createIcons();
}

function closeEditRider(event) {
  const modal = document.getElementById('modal-edit-rider');
  if (event && event.target !== modal) return;
  modal.classList.add('hidden');
}

function getStatusClass(status) {
  if (status === 'Disponível') return 'status-success';
  if (status === 'Em Descanso') return 'status-neutral';
  return 'status-progress';
}

async function submitEditRider(event) {
  event.preventDefault();
  const riderId = document.getElementById('edit-rider-id').value;
  const status = document.getElementById('edit-rider-status').value;
  const payload = {
    name: document.getElementById('edit-rider-name').value.trim(),
    pin: document.getElementById('edit-rider-pin').value.trim(),
    vehicle: document.getElementById('edit-rider-vehicle').value.trim(),
    plate: document.getElementById('edit-rider-plate').value.trim().toUpperCase(),
    status,
    status_class: getStatusClass(status),
    battery: document.getElementById('edit-rider-battery').value.trim()
  };

  if (supabaseClient) {
    const { error } = await supabaseClient
      .from('fleet')
      .update(payload)
      .eq('id', riderId);
    if (error) {
      alert('Erro ao editar motoboy: ' + error.message);
      return;
    }
  }

  await fetchFleet();
  renderFleetTable();
  closeEditRider();
  showToastNotification('Dados do motoboy atualizados.');
}

/* ================= NOTIFICATION BELL ================= */

function toggleNotifications() {
  const panel = document.getElementById('notification-panel');
  panel.classList.toggle('hidden');
}

function clearNotifications(event) {
  if (event) event.stopPropagation();
  document.getElementById('notification-list').innerHTML = `
    <div style="text-align: center; padding: 32px 16px; color: var(--color-text-muted);">
      <i data-lucide="check-circle" style="width: 36px; height: 36px; color: var(--success); display: inline-block; margin-bottom: 8px;"></i>
      <p style="font-size: 0.9rem;">Nenhuma notificação pendente.</p>
    </div>
  `;
  const badge = document.getElementById('bell-badge');
  if (badge) {
    badge.style.display = 'none';
    badge.textContent = '0';
  }
  lucide.createIcons();
}

// Helper to add notification to the topbar bell dropdown and play toast
function addBellNotification(title, type = 'chat') {
  const badge = document.getElementById('bell-badge');
  if (badge) {
    badge.style.display = 'flex';
    let count = parseInt(badge.textContent) || 0;
    count++;
    badge.textContent = count;
  }

  const list = document.getElementById('notification-list');
  if (list) {
    // If the list is empty (default placeholder), remove it
    if (list.querySelector('[data-lucide="check-circle"]') || list.innerHTML.includes('Nenhuma notificação pendente')) {
      list.innerHTML = '';
    }

    // Select icon and bg color based on type
    let icon = 'bell';
    let bgClass = 'bg-primary';
    if (type === 'chat') {
      icon = 'message-square';
      bgClass = 'bg-cyan';
    } else if (type === 'alert') {
      icon = 'alert-triangle';
      bgClass = 'bg-yellow';
    }

    const notifItem = document.createElement('div');
    notifItem.className = 'notif-item unread';
    notifItem.innerHTML = `
      <div class="notif-icon ${bgClass}"><i data-lucide="${icon}"></i></div>
      <div class="notif-content">
        <p>${title}</p>
        <span class="notif-time">Agora</span>
      </div>
    `;

    // Insert at the top of the list
    list.insertBefore(notifItem, list.firstChild);
    
    // Recompile Lucide icons so the new icon renders properly
    lucide.createIcons();
  }

  // Show dynamic toast notification (stripping html tags)
  const cleanTitle = title.replace(/<\/?[^>]+(>|$)/g, "");
  showToastNotification(cleanTitle);
}

// Close notification panel when clicking outside
document.addEventListener('click', function(e) {
  const panel = document.getElementById('notification-panel');
  const bell  = document.getElementById('notification-bell');
  if (panel && bell && !panel.classList.contains('hidden') && !bell.contains(e.target)) {
    panel.classList.add('hidden');
  }
});

/* ================= MOTOBOY REGISTRATION MODAL ================= */

function openRegisterMotoboy() {
  document.getElementById('modal-register-motoboy').classList.remove('hidden');
  document.getElementById('register-motoboy-form').reset();
  document.getElementById('register-motoboy-error').classList.add('hidden');
  lucide.createIcons();
}

function closeRegisterMotoboy(event) {
  // If called from overlay click, close; if called directly, close
  if (event && event.target !== document.getElementById('modal-register-motoboy')) return;
  document.getElementById('modal-register-motoboy').classList.add('hidden');
}

async function submitRegisterMotoboy(event) {
  event.preventDefault();

  const name     = document.getElementById('mb-name').value.trim();
  const vehicle  = document.getElementById('mb-vehicle').value.trim();
  const plate    = document.getElementById('mb-plate').value.trim().toUpperCase();
  const phone    = document.getElementById('mb-phone').value.trim();
  const battery  = document.getElementById('mb-battery').value;
  const pin      = document.getElementById('mb-pin').value.trim();

  const submitBtn = document.getElementById('register-motoboy-submit-btn');
  submitBtn.disabled = true;
  submitBtn.querySelector('span').innerText = 'Cadastrando...';

  const phoneDigits = phone.replace(/\D/g, '');
  if (phoneDigits.length < 4) {
    const errorEl = document.getElementById('register-motoboy-error');
    document.getElementById('register-motoboy-error-text').innerText = 'Informe um telefone válido para gerar o ID.';
    errorEl.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.querySelector('span').innerText = 'Cadastrar Motoboy';
    return;
  }

  // ID do motoboy: últimos 4 números do telefone pessoal.
  const newId = '#MB-' + phoneDigits.slice(-4);
  const existingRider = mockData.fleet.find(rider => rider.id === newId);
  if (existingRider) {
    const errorEl = document.getElementById('register-motoboy-error');
    document.getElementById('register-motoboy-error-text').innerText = `Já existe motoboy com o ID ${newId}. Verifique o telefone.`;
    errorEl.classList.remove('hidden');
    submitBtn.disabled = false;
    submitBtn.querySelector('span').innerText = 'Cadastrar Motoboy';
    return;
  }

  const newRider = {
    id: newId,
    name: name,
    vehicle: vehicle,
    plate: plate,
    status: 'Disponível',
    status_class: 'status-success',
    delivery: 'Nenhuma',
    battery: battery + '%',
    rating: 5.00,
    pin: pin
  };

  if (supabaseClient) {
    const { error } = await supabaseClient
      .from('fleet')
      .insert([newRider]);

    if (error) {
      const errorEl = document.getElementById('register-motoboy-error');
      document.getElementById('register-motoboy-error-text').innerText = 'Erro ao salvar: ' + error.message;
      errorEl.classList.remove('hidden');
      submitBtn.disabled = false;
      submitBtn.querySelector('span').innerText = 'Cadastrar Motoboy';
      return;
    }
  } else {
    // Offline fallback: add to local mockData
    mockData.fleet.push({
      id: newId,
      name: name,
      vehicle: vehicle,
      plate: plate,
      status: 'Disponível',
      statusClass: 'status-success',
      delivery: 'Nenhuma',
      battery: battery + '%',
      rating: 5.00
    });
  }

  // Refresh fleet table
  await fetchFleet();
  renderFleetTable();

  // Close registration modal and open credential card
  document.getElementById('modal-register-motoboy').classList.add('hidden');
  openCredentialCard(newId, name, pin);

  submitBtn.disabled = false;
  submitBtn.querySelector('span').innerText = 'Cadastrar Motoboy';
}

// Helper to show modern toast notification
function showToastNotification(message) {
  // Check if toast container exists, otherwise create it
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 10000; display: flex; flex-direction: column; gap: 10px; pointer-events: none;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.style.cssText = 'background: var(--bg-card); border-left: 4px solid var(--primary); color: var(--color-text); padding: 16px 24px; border-radius: var(--border-radius-md); box-shadow: var(--shadow-lg); font-family: var(--font-primary); font-size: 0.9rem; display: flex; align-items: center; gap: 10px; pointer-events: auto; border: 1px solid var(--border-color); animation: toast-in 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);';
  toast.innerHTML = `<i data-lucide="check-circle" style="color: var(--primary); width: 18px; height: 18px;"></i> <span style="font-weight: 500;">${message}</span>`;
  container.appendChild(toast);
  lucide.createIcons();

  // Remove toast after 4 seconds
  setTimeout(() => {
    toast.style.animation = 'toast-out 0.3s ease forwards';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

function renderClientRatings() {
  const list = document.getElementById('client-ratings-list');
  if (!list) return;

  list.innerHTML = clientRatings.map(item => `
    <div class="list-item">
      <div class="item-info">
        <div class="item-icon-avatar bg-yellow"><i data-lucide="star" class="text-black"></i></div>
        <div>
          <h4>${item.title}</h4>
          <p class="text-muted">${item.comment}</p>
          <p class="text-muted text-xs" style="margin-top: 4px;">${item.date}</p>
        </div>
      </div>
      <div class="courier-rating">
        <i data-lucide="star" class="fill-yellow text-yellow"></i>
        <strong>${item.score}</strong>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

function submitClientRating(event) {
  event.preventDefault();
  const score = Number(document.getElementById('rating-score').value);
  const comment = document.getElementById('rating-comment').value.trim();
  clientRatings.unshift({
    score,
    title: score >= 4 ? 'Nova avaliação positiva' : 'Avaliação precisa de atenção',
    comment: comment || 'Sem comentário adicional.',
    date: 'Agora'
  });
  document.getElementById('rating-comment').value = '';
  renderClientRatings();
  showToastNotification('Avaliação enviada.');
}

function openProfileSettings() {
  const profile = mockData.activeProfile;
  const creds = mockData.credentials[profile];
  document.getElementById('profile-name').value = creds.name || '';
  document.getElementById('profile-role').value = creds.role || '';
  document.getElementById('profile-avatar').value = creds.avatar || '';
  document.getElementById('profile-email').value = creds.email || '';
  document.getElementById('profile-partner').value = creds.partner || '';
  updateProfilePreview();
  document.getElementById('modal-profile-settings').classList.remove('hidden');
  lucide.createIcons();
}

function updateProfilePreview() {
  const avatar = document.getElementById('profile-avatar');
  const name = document.getElementById('profile-name');
  const role = document.getElementById('profile-role');
  const avatarPreview = document.getElementById('profile-avatar-preview');
  const namePreview = document.getElementById('profile-preview-name');
  const rolePreview = document.getElementById('profile-preview-role');

  if (avatarPreview) {
    avatarPreview.src = avatar && avatar.value ? avatar.value : document.getElementById('user-avatar').src;
  }
  if (namePreview) namePreview.innerText = name && name.value ? name.value : 'Nome do perfil';
  if (rolePreview) rolePreview.innerText = role && role.value ? role.value : 'Cargo / Função';
}

function closeProfileSettings(event) {
  const modal = document.getElementById('modal-profile-settings');
  if (event && event.target !== modal) return;
  modal.classList.add('hidden');
}

function submitProfileSettings(event) {
  event.preventDefault();
  const profile = mockData.activeProfile;
  const creds = mockData.credentials[profile];
  creds.name = document.getElementById('profile-name').value.trim();
  creds.role = document.getElementById('profile-role').value.trim();
  creds.avatar = document.getElementById('profile-avatar').value.trim() || creds.avatar;
  creds.email = document.getElementById('profile-email').value.trim();
  creds.partner = document.getElementById('profile-partner').value.trim();

  document.getElementById('user-avatar').src = creds.avatar;
  document.getElementById('user-display-name').innerText = creds.name;
  document.getElementById('user-display-sub').innerText = creds.partner
    ? `${creds.role} • Sócio: ${creds.partner}`
    : creds.role;

  closeProfileSettings();
  showToastNotification('Perfil atualizado nesta sessão.');
}

/* ================= PWA INSTALLATION & MODAL CONTROLS ================= */

let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log('beforeinstallprompt event fired');
});

window.addEventListener('appinstalled', (evt) => {
  console.log('PWA foi instalado com sucesso');
  showToastNotification("Aplicativo instalado com sucesso!");
  deferredPrompt = null;
});

window.installPWA = async function() {
  if (!deferredPrompt) {
    showToastNotification("Instalação direta indisponível. Por favor, instale manualmente usando o guia abaixo.");
    return;
  }
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`User choice: ${outcome}`);
  deferredPrompt = null;
};

window.showDownloadAppModal = function() {
  const modal = document.getElementById('modal-download-app');
  if (modal) {
    modal.classList.remove('hidden');
    lucide.createIcons();
  }
};

window.closeDownloadApp = function(event) {
  const modal = document.getElementById('modal-download-app');
  if (!modal) return;
  if (event) {
    const isOverlay = event.target === modal;
    const isCloseBtn = event.target.closest('.modal-close-btn');
    if (!isOverlay && !isCloseBtn) return;
  }
  modal.classList.add('hidden');
};

// ─── SUPPORT CHAT IMPLEMENTATION ─────────────────────────────────────────────

// Helper to create message bubbles
function createMessageBubble(msg, currentRole) {
  const isMe = msg.sender_role === currentRole;
  const alignStyle = isMe ? 'align-self: flex-end; align-items: flex-end;' : 'align-self: flex-start; align-items: flex-start;';
  
  // Premium gradients/colors for bubbles
  const bubbleStyle = isMe 
    ? 'background: linear-gradient(135deg, #f97316, #c2410c); color: #ffffff; border-radius: 16px 16px 2px 16px; box-shadow: 0 4px 12px rgba(249, 115, 22, 0.25);'
    : 'background: #272732; border: 1px solid var(--border-color); color: var(--color-text); border-radius: 16px 16px 16px 2px;';
  
  const time = msg.created_at ? new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Agora';

  return `
    <div style="display: flex; flex-direction: column; max-width: 70%; ${alignStyle}">
      <span style="font-size: 0.72rem; color: var(--color-text-muted); margin-bottom: 4px; font-weight: 500;">${msg.sender_name}</span>
      <div style="padding: 10px 16px; font-size: 0.88rem; line-height: 1.45; word-break: break-word; ${bubbleStyle}">
        ${escapeHtml(msg.message)}
      </div>
      <span style="font-size: 0.65rem; color: var(--color-text-muted); margin-top: 4px;">${time}</span>
    </div>
  `;
}

// ─── CLIENT CHAT LOGIC ────────────────────────────────────────────────────────

async function loadClientChatHistory() {
  const container = document.getElementById('client-chat-messages');
  if (!container) return;

  container.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; height: 100%;">
      <div style="width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--accent-cyan); border-radius: 50%; animation: spin 1s linear infinite;"></div>
    </div>
  `;

  const creds = mockData.credentials[mockData.activeProfile];
  if (!creds) return;

  if (!supabaseClient) {
    // Graceful fallback for offline/no-database
    const mockMessages = [
      { client_email: creds.email, sender_role: 'client', sender_name: creds.name, message: 'Olá, preciso de suporte.', created_at: new Date(Date.now() - 3600000).toISOString() },
      { client_email: creds.email, sender_role: 'admin', sender_name: 'Suporte Garra', message: 'Olá! Como podemos ajudar?', created_at: new Date(Date.now() - 1800000).toISOString() }
    ];
    renderClientMessages(mockMessages);
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('support_messages')
      .select('*')
      .eq('client_email', creds.email)
      .order('id', { ascending: true });

    if (error) throw error;

    renderClientMessages(data || []);
  } catch (err) {
    console.error("Error loading client chat history:", err);
    // Graceful fallback to mock messages on query failure
    const mockMessages = [
      { client_email: creds.email, sender_role: 'client', sender_name: creds.name, message: 'Olá, preciso de suporte. (Offline)', created_at: new Date(Date.now() - 3600000).toISOString() },
      { client_email: creds.email, sender_role: 'admin', sender_name: 'Suporte Garra', message: 'Olá! Como podemos ajudar?', created_at: new Date(Date.now() - 1800000).toISOString() }
    ];
    renderClientMessages(mockMessages);
  }
}

function renderClientMessages(messages) {
  const container = document.getElementById('client-chat-messages');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--color-text-muted); gap: 12px; padding: 20px;">
        <i data-lucide="message-square" style="width: 36px; height: 36px; color: var(--color-text-muted);"></i>
        <p style="font-size: 0.85rem; margin: 0;">Nenhuma mensagem enviada ainda.</p>
        <p style="font-size: 0.78rem; margin: 0; color: var(--color-text-muted);">Envie uma mensagem abaixo para falar com o suporte administrativo.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = messages.map(msg => createMessageBubble(msg, 'client')).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendClientChatMessage(event) {
  if (event) event.preventDefault();

  const input = document.getElementById('client-chat-input');
  if (!input) return;

  const val = input.value.trim();
  if (!val) return;

  const creds = mockData.credentials[mockData.activeProfile];
  if (!creds) return;

  input.value = ''; // Clear input immediately for responsive feel

  if (!supabaseClient) {
    const newMsg = {
      client_email: creds.email,
      sender_role: 'client',
      sender_name: creds.name,
      message: val,
      created_at: new Date().toISOString()
    };
    appendAndScrollClient(newMsg);

    // Simulate auto-reply from support admin
    setTimeout(() => {
      const reply = {
        client_email: creds.email,
        sender_role: 'admin',
        sender_name: 'Suporte Garra',
        message: 'Olá! Recebemos sua mensagem. Um atendente entrará em contato em breve.',
        created_at: new Date().toISOString()
      };
      appendAndScrollClient(reply);
    }, 1500);
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('support_messages')
      .insert([{
        client_email: creds.email,
        sender_role: 'client',
        sender_name: creds.name,
        message: val
      }]);

    if (error) throw error;
  } catch (err) {
    console.error("Error sending client chat message:", err);
    showToastNotification("Erro ao enviar mensagem.");
  }
}

function appendAndScrollClient(msg) {
  const container = document.getElementById('client-chat-messages');
  if (!container) return;

  // If there was empty state message, clear it
  const emptyState = container.querySelector('[data-lucide="message-square"]');
  if (emptyState) {
    container.innerHTML = '';
  }

  const div = document.createElement('div');
  div.style.display = 'contents';
  div.innerHTML = createMessageBubble(msg, 'client');
  container.appendChild(div);
  
  // Smooth scroll to bottom
  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

// ─── ADMIN CHAT LOGIC ─────────────────────────────────────────────────────────

async function loadAdminChatChannels() {
  const listContainer = document.getElementById('admin-chat-channels-list');
  if (!listContainer) return;

  listContainer.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; padding: 20px;">
      <div style="width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.1); border-top-color: var(--accent-cyan); border-radius: 50%; animation: spin 1s linear infinite;"></div>
    </div>
  `;

  if (!supabaseClient) {
    const defaultClients = [
      { email: 'gerente@burgerchef.com.br', name: 'Burger do Chef (Roberto)', lastMessage: 'Olá! Preciso de ajuda com um pedido.', time: '14:30' },
      { email: 'gerente@bellaitalia.com.br', name: 'Pizzaria Bella Italia', lastMessage: 'Sem mensagens anteriores', time: '' },
      { email: 'gerente@subwaygrill.com.br', name: 'Subway Grill', lastMessage: 'Sem mensagens anteriores', time: '' }
    ];
    renderAdminChatChannels(defaultClients);
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('support_messages')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw error;

    // Group by unique client_email
    const clientsMap = {};
    (data || []).forEach(msg => {
      clientsMap[msg.client_email] = {
        email: msg.client_email,
        name: msg.sender_role === 'client' ? msg.sender_name : (clientsMap[msg.client_email]?.name || 'Cliente Garra'),
        lastMessage: msg.message,
        time: new Date(msg.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };
    });

    // Ensure all three mock client restaurants are always listed
    const defaultClients = [
      { email: 'gerente@burgerchef.com.br', name: 'Burger do Chef (Roberto)' },
      { email: 'gerente@bellaitalia.com.br', name: 'Pizzaria Bella Italia' },
      { email: 'gerente@subwaygrill.com.br', name: 'Subway Grill' }
    ];
    
    defaultClients.forEach(c => {
      if (!clientsMap[c.email]) {
        clientsMap[c.email] = {
          email: c.email,
          name: c.name,
          lastMessage: 'Sem mensagens anteriores',
          time: ''
        };
      }
    });

    const channels = Object.values(clientsMap);
    renderAdminChatChannels(channels);
  } catch (err) {
    console.error("Error loading admin chat channels:", err);
    // Graceful fallback to default clients on error
    const defaultClients = [
      { email: 'gerente@burgerchef.com.br', name: 'Burger do Chef (Roberto)', lastMessage: 'Olá! Preciso de ajuda com um pedido.', time: '14:30' },
      { email: 'gerente@bellaitalia.com.br', name: 'Pizzaria Bella Italia', lastMessage: 'Sem mensagens anteriores', time: '' },
      { email: 'gerente@subwaygrill.com.br', name: 'Subway Grill', lastMessage: 'Sem mensagens anteriores', time: '' }
    ];
    renderAdminChatChannels(defaultClients);
  }
}

function renderAdminChatChannels(channels) {
  const listContainer = document.getElementById('admin-chat-channels-list');
  if (!listContainer) return;

  if (channels.length === 0) {
    listContainer.innerHTML = `<p class="text-muted" style="text-align: center; font-size: 0.8rem; padding: 20px;">Nenhuma conversa ativa.</p>`;
    return;
  }

  listContainer.innerHTML = channels.map(chan => {
    const isActive = activeChatClientEmail === chan.email;
    const activeBg = isActive ? 'background: rgba(255, 255, 255, 0.08); border-left: 3px solid var(--accent-cyan);' : 'border-left: 3px solid transparent;';
    const highlightHover = 'this.style.background=\'rgba(255, 255, 255, 0.05)\'';
    const normalBg = isActive ? 'this.style.background=\'rgba(255, 255, 255, 0.08)\'' : 'this.style.background=\'transparent\'';

    return `
      <div class="chat-channel-item" onclick="selectAdminChatChannel('${chan.email}', '${chan.name.replace(/'/g, "\\'")}')" 
           onmouseover="${highlightHover}" onmouseout="${normalBg}"
           style="padding: 14px 16px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid rgba(255,255,255,0.03); transition: background 0.2s; ${activeBg}">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <strong style="font-size: 0.88rem; color: var(--color-text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">${chan.name}</strong>
          <span style="font-size: 0.68rem; color: var(--color-text-muted);">${chan.time}</span>
        </div>
        <p style="font-size: 0.78rem; color: var(--color-text-muted); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${chan.lastMessage}</p>
      </div>
    `;
  }).join('');
}

async function selectAdminChatChannel(email, name) {
  activeChatClientEmail = email;
  activeChatClientName = name;

  // Clear admin chat dot when selecting a channel
  const adminDot = document.getElementById('admin-chat-dot');
  if (adminDot) adminDot.classList.add('hidden');

  // Toggle UI visibility
  document.getElementById('admin-chat-no-selection').classList.add('hidden');
  document.getElementById('admin-chat-window-pane').classList.remove('hidden');

  // Fill Header details
  document.getElementById('admin-chat-client-title').innerText = name;
  document.getElementById('admin-chat-client-subtitle').innerText = email;

  // Render channels again to update active tab highlight
  loadAdminChatChannels();

  // Load chat history for this client
  const chatMessages = document.getElementById('admin-chat-messages');
  if (chatMessages) {
    chatMessages.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100%;">
        <div style="width: 24px; height: 24px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--accent-cyan); border-radius: 50%; animation: spin 1s linear infinite;"></div>
      </div>
    `;
  }

  if (!supabaseClient) {
    let mockMessages = [];
    if (email === 'gerente@burgerchef.com.br') {
      mockMessages = [
        { client_email: email, sender_role: 'client', sender_name: 'Roberto Heinz', message: 'Olá! Preciso de ajuda com um pedido.', created_at: new Date(Date.now() - 3600000).toISOString() },
        { client_email: email, sender_role: 'admin', sender_name: 'Suporte Garra', message: 'Olá! Como posso ajudar você hoje?', created_at: new Date(Date.now() - 1800000).toISOString() }
      ];
    }
    renderAdminMessages(mockMessages);
    return;
  }

  try {
    const { data, error } = await supabaseClient
      .from('support_messages')
      .select('*')
      .eq('client_email', email)
      .order('id', { ascending: true });

    if (error) throw error;

    renderAdminMessages(data || []);
  } catch (err) {
    console.error("Error fetching messages for admin:", err);
    // Graceful fallback to mock messages on query failure
    let mockMessages = [];
    if (email === 'gerente@burgerchef.com.br') {
      mockMessages = [
        { client_email: email, sender_role: 'client', sender_name: 'Roberto Heinz', message: 'Olá! Preciso de ajuda com um pedido.', created_at: new Date(Date.now() - 3600000).toISOString() },
        { client_email: email, sender_role: 'admin', sender_name: 'Suporte Garra', message: 'Olá! Como posso ajudar você hoje?', created_at: new Date(Date.now() - 1800000).toISOString() }
      ];
    }
    renderAdminMessages(mockMessages);
  }
}

function renderAdminMessages(messages) {
  const container = document.getElementById('admin-chat-messages');
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `
      <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; color: var(--color-text-muted); gap: 8px;">
        <p style="font-size: 0.85rem; margin: 0;">Sem mensagens nesta conversa.</p>
        <p style="font-size: 0.78rem; margin: 0; color: var(--color-text-muted);">Envie uma resposta abaixo para iniciar a conversa.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = messages.map(msg => createMessageBubble(msg, 'admin')).join('');
  container.scrollTop = container.scrollHeight;
}

async function sendAdminChatMessage(event) {
  if (event) event.preventDefault();

  const input = document.getElementById('admin-chat-input');
  if (!input) return;

  const val = input.value.trim();
  if (!val) return;

  if (!activeChatClientEmail) return;

  const creds = mockData.credentials['owner'];
  if (!creds) return;

  input.value = ''; // Responsive feedback clear

  if (!supabaseClient) {
    const newMsg = {
      client_email: activeChatClientEmail,
      sender_role: 'admin',
      sender_name: creds.name,
      message: val,
      created_at: new Date().toISOString()
    };
    appendAndScrollAdmin(newMsg);
    
    // Simulate auto-reply
    setTimeout(() => {
      const reply = {
        client_email: activeChatClientEmail,
        sender_role: 'client',
        sender_name: activeChatClientName,
        message: 'Obrigado pelo retorno! Vou verificar aqui.',
        created_at: new Date().toISOString()
      };
      appendAndScrollAdmin(reply);
    }, 1500);
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('support_messages')
      .insert([{
        client_email: activeChatClientEmail,
        sender_role: 'admin',
        sender_name: creds.name,
        message: val
      }]);

    if (error) throw error;
  } catch (err) {
    console.error("Error sending admin message:", err);
    showToastNotification("Erro ao enviar resposta.");
  }
}

function appendAndScrollAdmin(msg) {
  const container = document.getElementById('admin-chat-messages');
  if (!container) return;

  const emptyMsg = container.querySelector('p');
  if (emptyMsg && emptyMsg.innerText.includes('Sem mensagens')) {
    container.innerHTML = '';
  }

  const div = document.createElement('div');
  div.style.display = 'contents';
  div.innerHTML = createMessageBubble(msg, 'admin');
  container.appendChild(div);

  container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
}

// ─── REALTIME SUPPORT SUBSCRIPTION ───────────────────────────────────────────

function subscribeSupportRealtime() {
  if (!supabaseClient) return;

  if (supportChatChannel) {
    supabaseClient.removeChannel(supportChatChannel);
  }

  supportChatChannel = supabaseClient.channel('realtime-support-channel')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'support_messages'
    }, (payload) => {
      const newMsg = payload.new;
      const currentRole = mockData.activeProfile;

      if (currentRole === 'owner') {
        // Admin View: reload conversations list to show last message
        loadAdminChatChannels();

        if (newMsg.sender_role === 'client') {
          // Add notification to bell
          addBellNotification(`<strong>${escapeHtml(newMsg.sender_name)}</strong>: ${escapeHtml(newMsg.message)}`, 'chat');

          // If not currently on owner-support, or active conversation does not match, show sidebar dot
          const isOwnerSupportActive = document.getElementById('tab-owner-support') && document.getElementById('tab-owner-support').classList.contains('active');
          if (!isOwnerSupportActive || activeChatClientEmail !== newMsg.client_email) {
            const adminDot = document.getElementById('admin-chat-dot');
            if (adminDot) adminDot.classList.remove('hidden');
          }
        }

        // If active conversation matches, append message bubble
        if (activeChatClientEmail === newMsg.client_email) {
          appendAndScrollAdmin(newMsg);
        }
      } else {
        // Client/Merchant View
        const creds = mockData.credentials[currentRole];
        if (creds && creds.email === newMsg.client_email) {
          if (newMsg.sender_role === 'admin') {
            // Add notification to bell
            addBellNotification(`<strong>Suporte</strong>: ${escapeHtml(newMsg.message)}`, 'chat');

            // If not currently on client-support, show sidebar dot
            const isClientSupportActive = document.getElementById('tab-client-support') && document.getElementById('tab-client-support').classList.contains('active');
            if (!isClientSupportActive) {
              const clientDot = document.getElementById('client-chat-dot');
              if (clientDot) clientDot.classList.remove('hidden');
            }
          }

          // Always append to chat messages
          appendAndScrollClient(newMsg);
        }
      }
    })
    .subscribe();
}

// ─── REQUEST DELIVERY MAP ─────────────────────────────────────────────────────

let requestDeliveryMap = null;
let requestDeliveryMarker = null;
let restaurantMarker = null;
let requestDeliveryRouteLine = null;
let requestDeliveryCenterCoords = [-23.55052, -46.633308]; // Fallback coordinates (São Paulo)

function initRequestDeliveryMap() {
  const mapContainer = document.getElementById('request-delivery-map');
  if (!mapContainer) return;

  // If map is already initialized, just invalidate size so it redraws correctly
  if (requestDeliveryMap) {
    setTimeout(() => {
      requestDeliveryMap.invalidateSize();
    }, 100);
    return;
  }

  // Create map instance
  requestDeliveryMap = L.map('request-delivery-map', { attributionControl: false }).setView(requestDeliveryCenterCoords, 14);

  // CartoDB Dark Matter tile layer for premium dark aesthetics
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20
  }).addTo(requestDeliveryMap);

  // Initialize restaurant marker HTML
  const restaurantIconHtml = `
    <div class="custom-map-marker central-marker" style="background-color: #ffffff; box-shadow: 0 0 15px #ffffff; border-color: var(--primary);">
      <div class="marker-pulse" style="border-color: var(--primary); animation-duration: 2.5s;"></div>
      <i class="marker-icon-dot" style="background-color: var(--primary); width: 6px; height: 6px; border-radius: 50%; display: block;"></i>
    </div>
  `;
  const restaurantIcon = L.divIcon({
    html: restaurantIconHtml,
    className: 'custom-div-icon',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  // Try to fetch user geolocation to center map on the client's city
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        requestDeliveryCenterCoords = [position.coords.latitude, position.coords.longitude];
        requestDeliveryMap.setView(requestDeliveryCenterCoords, 14);
        
        // Add restaurant marker at center
        restaurantMarker = L.marker(requestDeliveryCenterCoords, { icon: restaurantIcon }).addTo(requestDeliveryMap);
        restaurantMarker.bindPopup('<strong style="color:var(--color-text);">Seu Comércio</strong>').openPopup();
      },
      (error) => {
        console.warn("Geolocation failed or denied. Using fallback coordinates.", error);
        restaurantMarker = L.marker(requestDeliveryCenterCoords, { icon: restaurantIcon }).addTo(requestDeliveryMap);
        restaurantMarker.bindPopup('<strong style="color:var(--color-text);">Seu Comércio</strong>').openPopup();
      }
    );
  } else {
    restaurantMarker = L.marker(requestDeliveryCenterCoords, { icon: restaurantIcon }).addTo(requestDeliveryMap);
    restaurantMarker.bindPopup('<strong style="color:var(--color-text);">Seu Comércio</strong>').openPopup();
  }

  // Handle click on map to set delivery destination
  requestDeliveryMap.on('click', (e) => {
    const latlng = e.latlng;
    updateRequestDeliveryDestination(latlng.lat, latlng.lng);
  });

  // Setup direct geocoding input listener (with a debounce)
  setupAddressGeocodingListener();
}

function updateRequestDeliveryDestination(lat, lng, shouldCenter = false) {
  if (!requestDeliveryMap) return;

  const destIconHtml = `
    <div class="custom-map-marker" style="background-color: #ffb700; border-color: #ffffff; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 10px #ffb700;">
    </div>
  `;
  const destIcon = L.divIcon({
    html: destIconHtml,
    className: 'custom-div-icon',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  if (requestDeliveryMarker) {
    requestDeliveryMarker.setLatLng([lat, lng]);
  } else {
    requestDeliveryMarker = L.marker([lat, lng], { icon: destIcon, draggable: true }).addTo(requestDeliveryMap);
    
    // Listen to marker drag event
    requestDeliveryMarker.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      updateRequestDeliveryDestination(pos.lat, pos.lng);
    });
  }

  if (shouldCenter) {
    requestDeliveryMap.setView([lat, lng], 15);
  }

  // Update polyline route
  const startCoords = restaurantMarker ? restaurantMarker.getLatLng() : requestDeliveryCenterCoords;
  if (requestDeliveryRouteLine) {
    requestDeliveryRouteLine.setLatLngs([startCoords, [lat, lng]]);
  } else {
    requestDeliveryRouteLine = L.polyline([startCoords, [lat, lng]], {
      color: '#ffb700',
      dashArray: '5, 10',
      weight: 3
    }).addTo(requestDeliveryMap);
  }

  // Perform reverse geocoding
  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
    .then(res => res.json())
    .then(data => {
      if (data && data.display_name) {
        let addressStr = data.display_name;
        document.getElementById('delivery-address').value = addressStr;
        calculateEstimate();
      } else {
        document.getElementById('delivery-address').value = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
        calculateEstimate();
      }
    })
    .catch(err => {
      console.error("Reverse geocoding error:", err);
      document.getElementById('delivery-address').value = `Lat: ${lat.toFixed(5)}, Lng: ${lng.toFixed(5)}`;
      calculateEstimate();
    });
}

let geocodeDebounceTimeout = null;
function setupAddressGeocodingListener() {
  const addressInput = document.getElementById('delivery-address');
  const suggestionsContainer = document.getElementById('address-suggestions');
  if (!addressInput || !suggestionsContainer) return;

  addressInput.addEventListener('input', () => {
    const val = addressInput.value.trim();
    if (val.length < 3) {
      suggestionsContainer.innerHTML = '';
      suggestionsContainer.classList.add('hidden');
      return;
    }

    clearTimeout(geocodeDebounceTimeout);
    geocodeDebounceTimeout = setTimeout(() => {
      // Search query restricted to Rio Grande do Sul, Brazil
      const queryUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(val + ', Rio Grande do Sul')}&countrycodes=br&viewbox=-57.64,-27.08,-49.69,-33.75&bounded=1&limit=5`;
      
      fetch(queryUrl)
        .then(res => res.json())
        .then(data => {
          suggestionsContainer.innerHTML = '';
          if (data && data.length > 0) {
            data.forEach(item => {
              const div = document.createElement('div');
              div.className = 'autocomplete-item';
              div.innerText = item.display_name;
              
              div.addEventListener('click', () => {
                const lat = parseFloat(item.lat);
                const lng = parseFloat(item.lon);
                
                addressInput.value = item.display_name;
                suggestionsContainer.classList.add('hidden');
                
                // Update map marker and polyline
                updateRequestDeliveryDestination(lat, lng, true);
              });
              suggestionsContainer.appendChild(div);
            });
            suggestionsContainer.classList.remove('hidden');
          } else {
            suggestionsContainer.classList.add('hidden');
          }
        })
        .catch(err => {
          console.error("Geocoding search error:", err);
        });
    }, 400); // 400ms debounce
  });

  // Hide suggestions when clicking outside
  document.addEventListener('click', (e) => {
    if (e.target !== addressInput && e.target !== suggestionsContainer && !suggestionsContainer.contains(e.target)) {
      suggestionsContainer.classList.add('hidden');
    }
  });
}
// ─── REALTIME ORDER TRACKING ──────────────────────────────────────────────────

async function startRealtimeTracking(order) {
  const trackerStatus = document.getElementById('tracker-badge-status');
  const orderId = order.id;

  // Unsubscribe from any previous tracking channel
  if (trackingRealtimeChannel) {
    if (supabaseClient) supabaseClient.removeChannel(trackingRealtimeChannel);
    trackingRealtimeChannel = null;
  }

  // Determine coordinates
  const pickupLat = parseFloat(order.pickup_lat) || -23.55052;
  const pickupLng = parseFloat(order.pickup_lng) || -46.633308;
  const destLat = parseFloat(order.dest_lat) || -23.551;
  const destLng = parseFloat(order.dest_lng) || -46.634;

  // Initialize tracking Leaflet map
  initTrackingMap(pickupLat, pickupLng, destLat, destLng);

  // Set stepper initial active state
  updateStepperState(order.status || 'Buscando Entregador');

  if (supabaseClient) {
    // Check current state in database
    const { data: histData } = await supabaseClient
      .from('client_history')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (histData) {
      updateStepperState(histData.status);
      trackerStatus.innerText = translateStatus(histData.status);
      trackerStatus.className = getStatusClass(histData.status);
      await loadRiderDetails(orderId, histData.rider);
    } else {
      trackerStatus.innerText = 'Buscando Entregador';
      trackerStatus.className = 'status-badge status-warning';
    }

    // Subscribe to client_history & fleet status updates
    trackingRealtimeChannel = supabaseClient.channel(`tracking-${orderId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'client_history',
        filter: `id=eq.${orderId}`
      }, async (payload) => {
        const row = payload.new;
        if (!row) return;

        updateStepperState(row.status);
        trackerStatus.innerText = translateStatus(row.status);
        trackerStatus.className = getStatusClass(row.status);

        if (row.status === 'A caminho da coleta' || row.status === 'Em rota de entrega') {
          await loadRiderDetails(orderId, row.rider);
        }

        if (row.status === 'Entregue') {
          const tabBtn = document.getElementById('nav-tracking-tab');
          if (tabBtn) tabBtn.querySelector('.pulse-dot').classList.add('hidden');
          if (trackingRealtimeChannel) {
            supabaseClient.removeChannel(trackingRealtimeChannel);
            trackingRealtimeChannel = null;
          }
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'fleet'
      }, (payload) => {
        const rider = payload.new;
        if (rider && rider.delivery === orderId) {
          updateRiderMarker(parseFloat(rider.lat), parseFloat(rider.lng), rider.name);
          updateCourierCardUI(rider);
        }
      })
      .subscribe();
  }
}

function initTrackingMap(pickupLat, pickupLng, destLat, destLng) {
  const mapContainer = document.getElementById('tracking-map');
  if (!mapContainer) return;

  if (trackingMapInstance) {
    trackingMapInstance.remove();
    trackingMapInstance = null;
  }

  trackingMapInstance = L.map('tracking-map', { attributionControl: false }).setView([pickupLat, pickupLng], 14);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20
  }).addTo(trackingMapInstance);

  const pickupIconHtml = `
    <div class="custom-map-marker central-marker" style="background-color: #ffffff; box-shadow: 0 0 15px #ffffff; border-color: var(--primary);">
      <div class="marker-pulse" style="border-color: var(--primary); animation-duration: 2.5s;"></div>
      <i class="marker-icon-dot" style="background-color: var(--primary); width: 6px; height: 6px; border-radius: 50%; display: block;"></i>
    </div>
  `;
  const pickupIcon = L.divIcon({
    html: pickupIconHtml,
    className: 'custom-div-icon',
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });

  const destIconHtml = `
    <div class="custom-map-marker" style="background-color: #ffb700; border-color: #ffffff; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 10px #ffb700;">
    </div>
  `;
  const destIcon = L.divIcon({
    html: destIconHtml,
    className: 'custom-div-icon',
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  trackingPickupMarker = L.marker([pickupLat, pickupLng], { icon: pickupIcon }).addTo(trackingMapInstance);
  trackingPickupMarker.bindPopup('<strong style="color:var(--color-text);">Origem (Comércio)</strong>');

  trackingDestMarker = L.marker([destLat, destLng], { icon: destIcon }).addTo(trackingMapInstance);
  trackingDestMarker.bindPopup('<strong style="color:var(--color-text);">Destino (Cliente)</strong>');

  trackingRouteLine = L.polyline([[pickupLat, pickupLng], [destLat, destLng]], {
    color: '#ffb700',
    dashArray: '5, 10',
    weight: 3
  }).addTo(trackingMapInstance);

  const group = new L.featureGroup([trackingPickupMarker, trackingDestMarker]);
  trackingMapInstance.fitBounds(group.getBounds().pad(0.15));

  trackingRiderMarker = null;
}

function updateRiderMarker(lat, lng, riderName) {
  if (!trackingMapInstance || isNaN(lat) || isNaN(lng)) return;

  const riderIconHtml = `
    <div style="width:24px;height:24px;background:#f97316;border-radius:50%;border:3px solid #fff;box-shadow:0 0 12px rgba(249,115,22,0.7);display:flex;align-items:center;justify-content:center;">
      <i data-lucide="bike" style="width:12px;height:12px;color:#fff;"></i>
    </div>
  `;
  const riderIcon = L.divIcon({
    html: riderIconHtml,
    className: 'custom-div-icon',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  if (trackingRiderMarker) {
    trackingRiderMarker.setLatLng([lat, lng]);
  } else {
    trackingRiderMarker = L.marker([lat, lng], { icon: riderIcon }).addTo(trackingMapInstance);
    trackingRiderMarker.bindPopup(`<strong style="color:var(--color-text);">${escapeHtml(riderName)}</strong><br>Localização em tempo real`);
  }
  lucide.createIcons();
}

function updateStepperState(status) {
  document.querySelectorAll('.step-node').forEach(node => {
    node.className = 'step-node';
  });

  const nowTime = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  if (status === 'Buscando Entregador') {
    document.getElementById('step-1').className = 'step-node active';
    document.getElementById('step-1-time').innerText = 'Aguardando busca de motoboys...';
  } else if (status === 'A caminho da coleta') {
    document.getElementById('step-1').className = 'step-node completed';
    document.getElementById('step-2').className = 'step-node active';
    if (document.getElementById('step-2-time').innerText === '--:--') {
      document.getElementById('step-2-time').innerText = nowTime;
    }
  } else if (status === 'Em rota de entrega') {
    document.getElementById('step-1').className = 'step-node completed';
    document.getElementById('step-2').className = 'step-node completed';
    document.getElementById('step-3').className = 'step-node active';
    if (document.getElementById('step-3-time').innerText === '--:--') {
      document.getElementById('step-3-time').innerText = nowTime;
    }
  } else if (status === 'Entregue') {
    document.getElementById('step-1').className = 'step-node completed';
    document.getElementById('step-2').className = 'step-node completed';
    document.getElementById('step-3').className = 'step-node completed';
    document.getElementById('step-4').className = 'step-node completed';
    if (document.getElementById('step-4-time').innerText === '--:--') {
      document.getElementById('step-4-time').innerText = nowTime;
    }
  }
}

function translateStatus(status) {
  if (status === 'A caminho da coleta') return 'Entregador Coletando';
  if (status === 'Em rota de entrega') return 'Em Rota de Entrega';
  if (status === 'Entregue') return 'Concluído';
  return status;
}

function getStatusClass(status) {
  if (status === 'Entregue') return 'status-badge status-success';
  if (status === 'Buscando Entregador') return 'status-badge status-warning';
  return 'status-badge status-progress';
}

async function loadRiderDetails(orderId, riderName) {
  if (!supabaseClient) return;

  const { data: rider } = await supabaseClient
    .from('fleet')
    .select('*')
    .eq('name', riderName)
    .maybeSingle();

  if (rider) {
    updateCourierCardUI(rider);
    if (rider.lat && rider.lng) {
      updateRiderMarker(parseFloat(rider.lat), parseFloat(rider.lng), rider.name);
    }
  }
}

function updateCourierCardUI(rider) {
  const box = document.getElementById('tracker-courier-box');
  if (!box) return;

  box.classList.remove('hidden');
  document.getElementById('tracker-courier-name').innerText = rider.name;
  document.getElementById('tracker-courier-vehicle').innerText = `${rider.vehicle} - Placa: ${rider.plate}`;
  
  const img = document.getElementById('tracker-courier-img');
  img.src = (rider.id === '#SPD-101') 
    ? 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?q=80&w=256&auto=format&fit=crop' 
    : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=256&auto=format&fit=crop';
}

async function trackActiveOrder(orderId) {
  if (!supabaseClient) return;

  const { data: histData } = await supabaseClient
    .from('client_history')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();

  if (histData) {
    startRealtimeTracking({
      id: histData.id,
      pickup_lat: histData.pickup_lat,
      pickup_lng: histData.pickup_lng,
      dest_lat: histData.dest_lat,
      dest_lng: histData.dest_lng,
      status: histData.status
    });
  } else {
    const { data: pendingData } = await supabaseClient
      .from('pending_deliveries')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (pendingData) {
      startRealtimeTracking(pendingData);
    }
  }

  const trackingTabBtn = document.getElementById('nav-tracking-tab');
  if (trackingTabBtn) {
    trackingTabBtn.disabled = false;
    trackingTabBtn.querySelector('.pulse-dot').classList.remove('hidden');
  }
  switchDashboardTab('order-tracking');
}

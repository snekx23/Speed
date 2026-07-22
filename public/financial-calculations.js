(function attachGarraFinancial(root) {
  function calculateWeeklyRiderPayment(gross, credits, consumables) {
    const grossAmount = Number(gross) || 0;
    const creditsAmount = Number(credits) || 0;
    const consumablesAmount = Number(consumables) || 0;
    const garraFee = grossAmount * 0.10;
    const deliveryNet = grossAmount - garraFee;
    const net = deliveryNet - consumablesAmount + creditsAmount;

    return {
      grossAmount,
      creditsAmount,
      consumablesAmount,
      garraFee,
      deliveryNet,
      net,
    };
  }

  function getCreatedAtDate(row) {
    const value = row && row.created_at;
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // Week boundaries follow the local calendar, not UTC, so Sunday evening
  // deliveries cannot drift into the following Monday's closure.
  function getLocalWeekStart(value) {
    const source = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(source.getTime())) return null;

    const monday = new Date(source.getFullYear(), source.getMonth(), source.getDate());
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }

  function getLocalWeekKey(value) {
    const monday = getLocalWeekStart(value);
    if (!monday) return '';
    const month = String(monday.getMonth() + 1).padStart(2, '0');
    const day = String(monday.getDate()).padStart(2, '0');
    return `${monday.getFullYear()}-${month}-${day}`;
  }

  root.GarraFinancial = Object.freeze({
    calculateWeeklyRiderPayment,
    getCreatedAtDate,
    getLocalWeekStart,
    getLocalWeekKey,
  });
})(window);

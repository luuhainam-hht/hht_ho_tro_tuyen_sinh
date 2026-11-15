'use strict';
/** Hàm thuần: so checklist giấy tờ với các giấy thí sinh đã tick. */
function evaluate(items, confirmedCodes = []) {
  const confirmed = new Set(confirmedCodes);
  const missingMandatory = items.filter((i) => i.is_mandatory && !confirmed.has(i.code)).map((i) => ({ code: i.code, title: i.title, detail: i.detail }));
  const missingOptional = items.filter((i) => !i.is_mandatory && !confirmed.has(i.code)).map((i) => ({ code: i.code, title: i.title, detail: i.detail }));
  const mandatoryTotal = items.filter((i) => i.is_mandatory).length;
  return {
    complete: missingMandatory.length === 0,
    mandatoryTotal,
    mandatoryHave: mandatoryTotal - missingMandatory.length,
    missingMandatory,
    missingOptional,
    // Ảnh chụp checklist lúc đặt lịch: cán bộ thấy đúng những gì thí sinh khai, dù checklist sau đó thay đổi.
    snapshot: {
      complete: missingMandatory.length === 0,
      confirmed: items.filter((i) => confirmed.has(i.code)).map((i) => ({ code: i.code, title: i.title })),
      missingMandatory,
      missingOptional,
    },
  };
}

module.exports = { evaluate };

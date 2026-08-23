import React, { useState, useEffect, useCallback } from "react";

/* =========================================================================
   1. REFRIGERANT DATA LAYER
   PT anchor points cross-referenced from published R-410A saturation charts.
   R-410A glide is negligible (~0.3°F) so bubble/dew are set equal here.
   Values between anchors are linearly interpolated -- flagged as derived,
   not a verbatim chart lookup.
   ========================================================================= */
const REFRIGERANTS = {
  "R-410A": {
    id: "R-410A", type: "near-azeotropic blend (R-32/R-125)", glideF: 0.3,
    source: "cross-referenced published R-410A saturation data",
    sourceDate: "2026",
    ptTable: [
      { pressurePsig: 12, bubbleTempF: -37.7, dewTempF: -37.7 },
      { pressurePsig: 114, bubbleTempF: 37.8, dewTempF: 37.8 },
      { pressurePsig: 118, bubbleTempF: 39.5, dewTempF: 39.5 },
      { pressurePsig: 122, bubbleTempF: 41.3, dewTempF: 41.3 },
      { pressurePsig: 126, bubbleTempF: 43.0, dewTempF: 43.0 },
      { pressurePsig: 130, bubbleTempF: 44.7, dewTempF: 44.7 },
      { pressurePsig: 132, bubbleTempF: 45.5, dewTempF: 45.5 },
      { pressurePsig: 185.7, bubbleTempF: 65, dewTempF: 65 },
      { pressurePsig: 201.5, bubbleTempF: 70, dewTempF: 70 },
      { pressurePsig: 208.4, bubbleTempF: 72, dewTempF: 72 },
      { pressurePsig: 216, bubbleTempF: 74.3, dewTempF: 74.3 },
      { pressurePsig: 222, bubbleTempF: 76.1, dewTempF: 76.1 },
      { pressurePsig: 254.6, bubbleTempF: 85, dewTempF: 85 },
      { pressurePsig: 318, bubbleTempF: 100.2, dewTempF: 100.2 },
      { pressurePsig: 324, bubbleTempF: 101.6, dewTempF: 101.6 },
      { pressurePsig: 420, bubbleTempF: 120.7, dewTempF: 120.7 },
      { pressurePsig: 424, bubbleTempF: 121.4, dewTempF: 121.4 },
      { pressurePsig: 522, bubbleTempF: 137.6, dewTempF: 137.6 },
      { pressurePsig: 610, bubbleTempF: 150.0, dewTempF: 150.0 },
    ],
  },
};

function interpLinear(table, keyProp, valProp, x) {
  const sorted = [...table].sort((a, b) => a[keyProp] - b[keyProp]);
  if (x <= sorted[0][keyProp]) return sorted[0][valProp];
  if (x >= sorted[sorted.length - 1][keyProp]) return sorted[sorted.length - 1][valProp];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (x >= a[keyProp] && x <= b[keyProp]) {
      const t = (x - a[keyProp]) / (b[keyProp] - a[keyProp]);
      return a[valProp] + t * (b[valProp] - a[valProp]);
    }
  }
  return sorted[sorted.length - 1][valProp];
}
function satTempFromPsig(refrigerantId, psig) {
  return interpLinear(REFRIGERANTS[refrigerantId].ptTable, "pressurePsig", "dewTempF", psig);
}
function psigFromSatTemp(refrigerantId, tempF) {
  return interpLinear(REFRIGERANTS[refrigerantId].ptTable, "dewTempF", "pressurePsig", tempF);
}

/* =========================================================================
   2. EQUIPMENT CONFIGURATIONS  (scope: split AC, mini-split, RTU, furnace)
   Labels are DERIVED from these fields via equipmentLabel() -- never a
   separately-authored string -- so a config's displayed description and
   its actual data cannot drift apart.
   ========================================================================= */
const CONFIGS = {
  split_ac_r410a_txv_3ton: {
    id: "split_ac_r410a_txv_3ton", equipmentFamily: "split_ac", system: "cooling",
    refrigerantId: "R-410A", meteringDevice: "TXV", tonnage: 3, nominalCFM: 1200,
    designEvapSatTempF: 40, designCondApproachF: 25, designSuperheatF: 10, designSubcoolingF: 10,
    minLineLength: 15, maxLineLength: 40,
  },
  minisplit_r410a_eev_1p5ton: {
    id: "minisplit_r410a_eev_1p5ton", equipmentFamily: "mini_split", system: "cooling",
    refrigerantId: "R-410A", meteringDevice: "EEV", tonnage: 1.5, nominalCFM: 500,
    designEvapSatTempF: 40, designCondApproachF: 25, designSuperheatF: 8, designSubcoolingF: 9,
    minLineLength: 15, maxLineLength: 65,
  },
  rtu_r410a_fixedorifice_5ton: {
    id: "rtu_r410a_fixedorifice_5ton", equipmentFamily: "packaged_unit", system: "cooling",
    refrigerantId: "R-410A", meteringDevice: "fixed_orifice", tonnage: 5, nominalCFM: 2000,
    designEvapSatTempF: 40, designCondApproachF: 25, designSuperheatF: 12, designSubcoolingF: 10,
    minLineLength: 10, maxLineLength: 25,
  },
  furnace_80afue_hsi_singlestage: {
    id: "furnace_80afue_hsi_singlestage", equipmentFamily: "furnace", system: "heating",
    efficiencyRating: "80% AFUE", heatingInputBTU: 80000, heatingOutputBTU: 64000,
    temperatureRiseRangeF: [35, 65], ignitionSystem: "hot_surface_igniter", staging: "single",
    nominalCFM: 1200,
    normalInducerAmpsRange: [1.0, 1.4],
    normalVentStaticRangeInWC: [0.3, 0.5],
    designManifoldPressureInWC: 3.5,
    normalBlowerAmpsRange: [4.5, 5.5],
  },
};

const FAMILY_NOUN = { split_ac: "residential split AC", mini_split: "ductless mini-split", packaged_unit: "packaged rooftop unit" };
const METERING_LABEL = { TXV: "TXV", EEV: "EEV", fixed_orifice: "fixed-orifice" };
const IGNITION_LABEL = { hot_surface_igniter: "hot surface ignition" };
function equipmentLabel(config) {
  if (config.system === "cooling") {
    return `${config.tonnage}-ton ${FAMILY_NOUN[config.equipmentFamily]}, ${METERING_LABEL[config.meteringDevice]} metering`;
  }
  return `${config.efficiencyRating} gas furnace, ${config.staging}-stage, ${IGNITION_LABEL[config.ignitionSystem]}`;
}

/* Sequence of operation -- furnace only, in this scope */
const SEQUENCES = {
  furnace_80afue_hsi_singlestage: [
    { id: "call_for_heat", order: 1, name: "Call for heat" },
    { id: "draft_proving", order: 2, name: "Inducer starts / draft pressure switch proves" },
    { id: "ignition_trial", order: 3, name: "Igniter warms, gas valve opens, ignition trial" },
    { id: "flame_proving", order: 4, name: "Flame sensor proves flame (rectification signal)" },
    { id: "run", order: 5, name: "Gas valve holds open, blower runs, heating" },
  ],
};

/* =========================================================================
   3. OPERATING CONDITIONS GENERATOR
   ========================================================================= */
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max, dp = 1) { const v = Math.random() * (max - min) + min; return parseFloat(v.toFixed(dp)); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function generateOperatingConditions(config) {
  if (config.system === "cooling") {
    const loadTier = pick(["normal", "normal", "high"]);
    const outdoorTempF = loadTier === "high" ? randInt(92, 104) : randInt(78, 91);
    const indoorTempF = randInt(74, 78);
    return {
      outdoorTempF, indoorTempF, returnAirTempF: indoorTempF,
      indoorRH: randInt(45, 55),
      airflowCFM: config.nominalCFM + randInt(-40, 40),
      systemLoad: loadTier, operatingMode: "cooling",
      lineLength: randInt(config.minLineLength, config.maxLineLength),
      elevation: 0,
    };
  }
  const outdoorTempF = randInt(15, 45);
  const indoorTempF = randInt(66, 70);
  return {
    outdoorTempF, indoorTempF, returnAirTempF: indoorTempF,
    airflowCFM: config.nominalCFM + randInt(-50, 50),
    operatingMode: "heating", elevation: 0,
  };
}

/* =========================================================================
   4. FAULT DEFINITIONS
   Physical plausibility bounds -- centralized here, applied to every
   refrigeration fault's output inside refrigMeasurements() so no single
   fault formula can produce a combination that isn't field-realistic.
   Pressure is only ever obtained by converting a saturation temperature
   through the PT table -- never generated on its own. The one deliberate
   exception is refrig-noncondensables, where the whole diagnostic point
   is a gauge pressure that DOESN'T match what the true liquid line
   temperature would predict -- that mismatch is commented inline.
   ========================================================================= */
const PHYS_BOUNDS = {
  suctionSatMin: 15, suctionSatMax: 55,
  minCondApproach: 12,
  condSatMax: 175,
  superheatMax: 38,
  subcoolMax: 30,
  subcoolMin: 0.5,
};

function refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF }) {
  const r = config.refrigerantId;
  const evapSatClamped = clamp(evapSatF, PHYS_BOUNDS.suctionSatMin, PHYS_BOUNDS.suctionSatMax);
  const superheatClamped = clamp(superheatF, 0, PHYS_BOUNDS.superheatMax);
  const minCondSat = cond.outdoorTempF + PHYS_BOUNDS.minCondApproach;
  const condSatClamped = clamp(condSatF, minCondSat, PHYS_BOUNDS.condSatMax);
  const subcoolClamped = clamp(subcoolingF, PHYS_BOUNDS.subcoolMin, PHYS_BOUNDS.subcoolMax);

  const suctionPsig = psigFromSatTemp(r, evapSatClamped);
  const liquidPsig = psigFromSatTemp(r, condSatClamped);
  return {
    suctionPsig: Math.round(suctionPsig),
    liquidPsig: Math.round(liquidPsig),
    suctionSatTempF: Math.round(evapSatClamped * 10) / 10,
    liquidSatTempF: Math.round(condSatClamped * 10) / 10,
    superheatF: Math.round(superheatClamped * 10) / 10,
    subcoolingF: Math.round(subcoolClamped * 10) / 10,
    suctionLineTempF: Math.round((evapSatClamped + superheatClamped) * 10) / 10,
    liquidLineTempF: Math.round((condSatClamped - subcoolClamped) * 10) / 10,
  };
}

const FAULTS = [
  /* ---------------- REFRIGERATION ---------------- */
  {
    id: "refrig-undercharge",
    appliesTo: ["split_ac_r410a_txv_3ton", "minisplit_r410a_eev_1p5ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "intermediate",
    complaints: [
      "Customer says the house won't cool below the mid-70s even after hours of runtime.",
      "System runs constantly and never quite catches up to the thermostat setpoint.",
    ],
    hints: [
      "Don't look at suction pressure by itself -- compare it with both superheat and subcooling before deciding what's short.",
      "If subcooling is running low at the same time superheat is running high, what does that tell you about how much liquid refrigerant is actually available versus how the system is metering it?",
    ],
    minimumRequiredEvidence: ["suctionSatTempF", "superheatF", "subcoolingF"],
    measurementRule: (config, cond) => {
      const severity = randInt(8, 16);
      const evapSatF = config.designEvapSatTempF - severity;
      const superheatF = config.designSuperheatF + severity * 0.8 + randFloat(-1, 2);
      const condSatF = cond.outdoorTempF + config.designCondApproachF - severity * 0.3 + randFloat(-1, 1);
      const subcoolingF = config.designSubcoolingF - severity * 0.6 + randFloat(-1, 1);
      return refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "high", minAbsDelta: 4 },
      { measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "low", minAbsDelta: 3 },
    ],
    reasoning: {
      primaryDiagnosis: "Refrigerant undercharge",
      acceptableDiagnoses: ["refrigerant undercharge", "low refrigerant charge", "system is undercharged", "low on charge", "insufficient refrigerant charge"],
      acceptablePartialDiagnoses: ["refrigerant problem", "charge issue", "evaporator starved", "low charge suspected"],
      differentialDiagnosis: [
        { faultId: "refrig-low-airflow-evap", strength: "strong", whyItCouldFit: "Also produces low suction pressure with high superheat", evidenceThatRulesItOut: "Subcooling is low here rather than near target -- a pure airflow restriction generally leaves the condenser/charge unaffected, so subcooling would be expected to stay closer to normal" },
        { faultId: "refrig-restricted-metering", strength: "strong", whyItCouldFit: "Also produces low suction with elevated superheat", evidenceThatRulesItOut: "Subcooling is low here, not high; a restricted metering device tends to back liquid up in the condenser and read high subcooling, the opposite direction" },
        { faultId: "refrig-dirty-condenser", strength: "strong", whyItCouldFit: "Both can show reduced system performance", evidenceThatRulesItOut: "Head pressure is not elevated here -- a condenser airflow problem more typically raises head pressure with normal-to-high subcooling" },
      ],
      minimumConclusion: "Identifies low refrigerant charge as the cause, citing low suction pressure together with high superheat AND low subcooling -- not just one of the three.",
    },
  },
  {
    id: "refrig-dirty-condenser",
    appliesTo: ["split_ac_r410a_txv_3ton", "minisplit_r410a_eev_1p5ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "beginner",
    complaints: [
      "Outdoor unit is working hard and running constantly, and the tech notices the outdoor coil looks pretty dirty on approach -- but cooling is still weak.",
      "System cools slowly, the compressor seems to run nonstop, and the outdoor coil fins look caked with debris.",
    ],
    hints: [
      "Check whether the suction side looks normal before assuming the whole system is short on refrigerant.",
      "High head pressure with normal-to-high subcooling usually means refrigerant is backing up somewhere on the high side, not missing altogether.",
    ],
    minimumRequiredEvidence: ["suctionSatTempF", "superheatF", "liquidSatTempF", "subcoolingF"],
    measurementRule: (config, cond) => {
      const severity = randInt(15, 30);
      const evapSatF = config.designEvapSatTempF + randFloat(-2, 2);
      const superheatF = config.designSuperheatF + randFloat(-2, 2);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + severity;
      const subcoolingF = config.designSubcoolingF + severity * 0.15 + randFloat(-1, 1);
      return refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "normal", maxAbsDelta: 3 },
      { measurement: "suctionSatTempF", designKey: "designEvapSatTempF", direction: "normal", maxAbsDelta: 3 },
    ],
    reasoning: {
      primaryDiagnosis: "Dirty or restricted condenser coil",
      acceptableDiagnoses: ["dirty condenser coil", "restricted condenser airflow", "condenser coil needs cleaning", "condenser is dirty/blocked"],
      acceptablePartialDiagnoses: ["condenser airflow problem", "condenser side issue", "head pressure problem"],
      differentialDiagnosis: [
        { faultId: "refrig-undercharge", strength: "strong", whyItCouldFit: "Both are common causes of poor cooling", evidenceThatRulesItOut: "Superheat and suction are normal here; undercharge more typically drops suction and raises superheat, neither of which is seen" },
        { faultId: "refrig-restricted-metering", strength: "moderate", whyItCouldFit: "Both can show elevated subcooling", evidenceThatRulesItOut: "Suction/superheat stay normal here; a restricted metering device also tends to drop suction pressure and raise superheat" },
      ],
      minimumConclusion: "Identifies the condenser (dirty coil / restricted outdoor airflow) as the cause, citing elevated head pressure with normal suction-side readings.",
    },
  },
  {
    id: "refrig-low-airflow-evap",
    appliesTo: ["split_ac_r410a_txv_3ton", "minisplit_r410a_eev_1p5ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "intermediate",
    complaints: [
      "System isn't cooling properly, and there's frost forming on the refrigerant line.",
      "Cooling is weak and the homeowner mentions ice building up on a line outside the indoor unit.",
    ],
    hints: [
      "A low suction reading with high superheat can come from either a charge problem or an airflow problem -- subcooling is what tells them apart.",
      "If the condenser side of the system checks out fine, where else could the evaporator be losing the heat it needs to boil off refrigerant normally?",
    ],
    minimumRequiredEvidence: ["suctionSatTempF", "superheatF", "subcoolingF"],
    measurementRule: (config, cond) => {
      const severity = randInt(10, 20);
      const evapSatF = config.designEvapSatTempF - severity;
      const superheatF = config.designSuperheatF + severity * 0.9 + randFloat(-1, 1);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randFloat(-2, 2);
      const subcoolingF = config.designSubcoolingF + randFloat(-1.5, 1.5);
      return refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "high", minAbsDelta: 5 },
      { measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "normal", maxAbsDelta: 3 },
    ],
    reasoning: {
      primaryDiagnosis: "Restricted airflow across the evaporator (dirty filter / weak blower) starving the coil",
      acceptableDiagnoses: ["dirty filter", "restricted airflow across evaporator", "low airflow starving the coil", "airflow problem at the indoor coil"],
      acceptablePartialDiagnoses: ["airflow issue", "indoor coil not getting enough air", "evaporator icing"],
      differentialDiagnosis: [
        { faultId: "refrig-undercharge", strength: "strong", whyItCouldFit: "Also produces low suction with high superheat and coil icing", evidenceThatRulesItOut: "Subcooling reads near target here; undercharge would typically also pull subcooling down. Normal subcooling with abnormal superheat is more consistent with an airflow restriction than a charge shortage" },
        { faultId: "refrig-restricted-metering", strength: "moderate", whyItCouldFit: "Similar suction/superheat pattern", evidenceThatRulesItOut: "Subcooling is normal here; a restricted metering device tends to raise it" },
        { faultId: "rtu-economizer-fault", strength: "weak", whyItCouldFit: "On an RTU, an economizer bringing in cold outdoor air can produce a nearly identical suction/superheat/subcooling pattern", evidenceThatRulesItOut: "Only checkable via the economizer damper position and mixed-air temperature -- if those aren't part of this scenario's evidence, a filter/airflow restriction remains the better-supported answer" },
      ],
      minimumConclusion: "Identifies restricted airflow (not charge) as the cause, specifically citing that subcooling is normal while superheat is high.",
    },
  },
  {
    id: "refrig-restricted-metering",
    appliesTo: ["split_ac_r410a_txv_3ton", "minisplit_r410a_eev_1p5ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "advanced",
    complaints: ["System barely cools and the compressor sounds like it's straining under load -- nothing looks obviously wrong at the outdoor unit."],
    hints: [
      "This one looks similar to a charge problem at first glance -- pay close attention to which direction subcooling moved.",
      "Something between the condenser outlet and the evaporator inlet may be limiting how much liquid gets through -- compare that possibility with what an overcharge would look like on the same two readings.",
    ],
    minimumRequiredEvidence: ["suctionSatTempF", "superheatF", "liquidSatTempF", "subcoolingF"],
    measurementRule: (config, cond) => {
      const severity = randInt(10, 20);
      const evapSatF = config.designEvapSatTempF - severity;
      const superheatF = config.designSuperheatF + severity * 1.1 + randFloat(-1, 1);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + severity * 0.4 + randFloat(-1, 1);
      const subcoolingF = config.designSubcoolingF + severity * 0.8 + randFloat(-1, 1);
      return refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "high", minAbsDelta: 6 },
      { measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "high", minAbsDelta: 4 },
    ],
    reasoning: {
      primaryDiagnosis: "Restricted metering device (clogged TXV/EEV/orifice) starving the evaporator",
      acceptableDiagnoses: ["restricted metering device", "clogged txv", "plugged orifice", "metering device restriction"],
      acceptablePartialDiagnoses: ["metering device problem", "txv issue", "restriction in the liquid line"],
      differentialDiagnosis: [
        { faultId: "refrig-undercharge", strength: "strong", whyItCouldFit: "Also low suction with high superheat", evidenceThatRulesItOut: "Subcooling is high here, not low; undercharge typically shows low subcooling since there generally isn't enough refrigerant to back up anywhere -- the opposite of this pattern" },
        { faultId: "refrig-overcharge", strength: "moderate", whyItCouldFit: "Also shows elevated subcooling", evidenceThatRulesItOut: "Suction is low and superheat is high here; overcharge tends to keep the suction side much closer to normal since the excess refrigerant sits on the high side" },
        { faultId: "refrig-low-airflow-evap", strength: "moderate", whyItCouldFit: "Also low suction with high superheat, possible icing", evidenceThatRulesItOut: "Subcooling is elevated here rather than normal" },
      ],
      minimumConclusion: "Identifies a metering-device restriction, specifically citing HIGH subcooling together with low suction/high superheat -- the combination that separates it from both undercharge and overcharge.",
    },
  },
  {
    id: "refrig-overcharge",
    appliesTo: ["split_ac_r410a_txv_3ton", "minisplit_r410a_eev_1p5ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "advanced",
    complaints: ["System cools, but not as well as it should, and the outdoor unit was recently serviced -- customer isn't sure what was done."],
    hints: [
      "Notice that the suction side doesn't look nearly as disturbed as the liquid side -- what does that split tell you about where the problem is?",
      "Subcooling that's clearly elevated, not just slightly, points toward liquid backing up somewhere on the high side rather than a shortage anywhere in the system.",
    ],
    minimumRequiredEvidence: ["suctionSatTempF", "superheatF", "liquidSatTempF", "subcoolingF"],
    measurementRule: (config, cond) => {
      const severity = randInt(10, 20);
      const evapSatF = config.designEvapSatTempF + severity * 0.15 + randFloat(-1, 1);
      const superheatF = config.designSuperheatF - severity * 0.2 + randFloat(-1, 1);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + severity * 0.5 + randFloat(-1, 1);
      const subcoolingF = config.designSubcoolingF + severity * 0.9 + randFloat(-1, 1);
      return refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
    },
    validationChecks: [
      { measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "high", minAbsDelta: 8 },
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "normal", maxAbsDelta: 4 },
      { measurement: "suctionSatTempF", designKey: "designEvapSatTempF", direction: "normal", maxAbsDelta: 4 },
    ],
    reasoning: {
      primaryDiagnosis: "Refrigerant overcharge",
      acceptableDiagnoses: ["overcharge", "too much refrigerant", "system is overcharged", "excess refrigerant charge"],
      acceptablePartialDiagnoses: ["charge issue", "high side problem"],
      differentialDiagnosis: [
        { faultId: "refrig-dirty-condenser", strength: "moderate", whyItCouldFit: "Both show elevated head pressure", evidenceThatRulesItOut: "Subcooling here is elevated well beyond what a dirty coil alone typically produces, and suction/superheat stay essentially normal rather than showing the mild suction rise a badly restricted coil can cause" },
        { faultId: "refrig-restricted-metering", strength: "strong", whyItCouldFit: "Also produces high subcooling", evidenceThatRulesItOut: "Suction and superheat stay close to normal here; a restricted metering device drops suction and raises superheat noticeably" },
      ],
      minimumConclusion: "Identifies overcharge as the cause, citing subcooling clearly elevated beyond normal while the suction side stays close to design.",
    },
  },
  {
    id: "refrig-noncondensables",
    appliesTo: ["split_ac_r410a_txv_3ton", "minisplit_r410a_eev_1p5ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "expert",
    complaints: ["System cools somewhat but head pressure runs high according to the last service note, and performance has been gradually declining -- nothing else about the unit stands out."],
    hints: [
      "The refrigerant-side numbers on the suction side look basically normal here -- so don't start your reasoning there.",
      "Try comparing what the gauge pressure implies about temperature against what the liquid line is actually measuring directly.",
    ],
    minimumRequiredEvidence: ["liquidPsig", "liquidLineTempF", "suctionSatTempF", "superheatF"],
    measurementRule: (config, cond) => {
      const offsetPsig = randInt(18, 32);
      const baseCondSatF = cond.outdoorTempF + config.designCondApproachF + randFloat(2, 8);
      const evapSatF = config.designEvapSatTempF + randFloat(-2, 2);
      const superheatF = config.designSuperheatF + randFloat(-2, 2);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF: baseCondSatF, subcoolingF: config.designSubcoolingF });
      const r = config.refrigerantId;
      // Deliberate exception: the gauge reads MORE pressure than the true condensing
      // temperature would produce, because trapped non-condensable gas adds its own
      // partial pressure on top of the refrigerant's. The liquid line temperature is
      // measured independently (a clamp-on reading), so it does NOT move with the
      // inflated gauge pressure -- that mismatch IS the fault signature.
      const truePsig = psigFromSatTemp(r, baseCondSatF);
      const displayedLiquidPsig = Math.round(truePsig + offsetPsig);
      const displayedLiquidSatTempF = Math.round(satTempFromPsig(r, displayedLiquidPsig) * 10) / 10;
      const trueLiquidLineTempF = Math.round((baseCondSatF - (config.designSubcoolingF + randFloat(-1, 1))) * 10) / 10;
      const apparentSubcoolingF = Math.round((displayedLiquidSatTempF - trueLiquidLineTempF) * 10) / 10;
      return {
        ...base,
        liquidPsig: displayedLiquidPsig,
        liquidSatTempF: displayedLiquidSatTempF,
        liquidLineTempF: trueLiquidLineTempF,
        subcoolingF: apparentSubcoolingF,
      };
    },
    validationChecks: [
      { measurement: "suctionSatTempF", designKey: "designEvapSatTempF", direction: "normal", maxAbsDelta: 3 },
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "normal", maxAbsDelta: 3 },
    ],
    extraValidation: (config, cond, m) => {
      const notes = [];
      const impliedApproach = m.liquidSatTempF - cond.outdoorTempF;
      if (impliedApproach < config.designCondApproachF + 10) notes.push("non-condensables signature too weak -- gauge pressure not disproportionate enough to outdoor ambient");
      if (m.subcoolingF > config.designSubcoolingF - 1) notes.push("apparent subcooling not anomalously low enough to be distinguishable from a normal reading");
      return notes;
    },
    reasoning: {
      primaryDiagnosis: "Non-condensable gas (air/moisture) trapped in the system, inflating head pressure beyond what the refrigerant alone would produce",
      acceptableDiagnoses: ["non-condensables in the system", "air in the system", "trapped air or moisture in the refrigerant circuit", "system needs to be evacuated -- non-condensable gas present"],
      acceptablePartialDiagnoses: ["head pressure doesn't match the refrigerant's PT relationship", "something other than refrigerant is contributing to head pressure", "high side contamination"],
      differentialDiagnosis: [
        { faultId: "refrig-dirty-condenser", strength: "moderate", whyItCouldFit: "Both show elevated head pressure with a roughly normal suction side", evidenceThatRulesItOut: "The gap between what the gauge pressure implies (via the PT relationship) and the actual liquid line temperature is unusually large -- a dirty coil raises head pressure in a way that stays consistent with the PT relationship, it doesn't break it" },
        { faultId: "refrig-overcharge", strength: "moderate", whyItCouldFit: "Both elevate head pressure with a fairly normal suction side", evidenceThatRulesItOut: "Overcharge raises subcooling; here the calculated subcooling looks unusually low given how high the gauge pressure reads, which points at the pressure reading itself being unreliable rather than at excess liquid" },
      ],
      minimumConclusion: "Identifies that the gauge pressure and the actual liquid line temperature don't agree the way the refrigerant's PT relationship predicts, and attributes that mismatch to non-condensable gas rather than a charge, coil, or metering problem.",
    },
  },
  {
    id: "refrig-compressor-worn",
    appliesTo: ["split_ac_r410a_txv_3ton", "minisplit_r410a_eev_1p5ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "expert",
    complaints: ["System runs, sounds normal, and nothing looks obviously wrong -- but it just isn't cooling the space like it used to, even on a mild day."],
    hints: [
      "No single reading here looks dramatically wrong -- look at the relationship between the two pressures rather than either one in isolation.",
      "A system that isn't cooling as well as it should, without a clear charge, airflow, or metering explanation, may be losing performance somewhere else in the cycle entirely.",
    ],
    minimumRequiredEvidence: ["suctionSatTempF", "liquidSatTempF", "superheatF", "subcoolingF"],
    measurementRule: (config, cond) => {
      const severity = randInt(8, 16);
      const evapSatF = config.designEvapSatTempF + severity * 0.3 + randFloat(-1, 1);
      const superheatF = config.designSuperheatF + randFloat(-2, 2);
      const condSatF = cond.outdoorTempF + config.designCondApproachF - severity * 0.4 + randFloat(-1, 1);
      const subcoolingF = config.designSubcoolingF + randFloat(-2, 2);
      return refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "normal", maxAbsDelta: 4 },
      { measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "normal", maxAbsDelta: 4 },
    ],
    extraValidation: (config, cond, m) => {
      const notes = [];
      const suctionRise = m.suctionSatTempF - config.designEvapSatTempF;
      const headDrop = (cond.outdoorTempF + config.designCondApproachF) - m.liquidSatTempF;
      if (suctionRise < 2) notes.push("suction-side rise too small to distinguish from normal");
      if (headDrop < 3) notes.push("head-side drop too small to distinguish from normal");
      return notes;
    },
    reasoning: {
      primaryDiagnosis: "Reduced compressor pumping capacity (worn valves/reduced compression ratio)",
      acceptableDiagnoses: ["worn compressor", "weak compressor", "compressor losing pumping capacity", "reduced compressor efficiency"],
      acceptablePartialDiagnoses: ["compressor performance problem", "mechanical compressor issue suspected"],
      differentialDiagnosis: [
        { faultId: "refrig-undercharge", strength: "moderate", whyItCouldFit: "Both can involve a suction reading above where it should sit relative to head", evidenceThatRulesItOut: "Superheat and subcooling both stay close to normal here; undercharge typically disturbs both noticeably" },
        { faultId: "refrig-dirty-condenser", strength: "weak", whyItCouldFit: "General reduced performance complaint", evidenceThatRulesItOut: "Head pressure is lower than design here, not higher -- the opposite of what a restricted condenser produces" },
      ],
      minimumConclusion: "Identifies reduced compressor performance as the cause, citing suction pressure running a bit above design and head pressure running a bit below design at the same time, with superheat/subcooling otherwise normal and no charge/airflow/metering explanation fitting.",
    },
  },
  {
    id: "elec-condenser-fan-motor-open",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "intermediate",
    complaints: ["Outdoor unit is running, but cooling has dropped off, and the tech notices the condenser fan isn't spinning at all."],
    hints: [
      "High head pressure has more than one possible cause -- confirm whether the condenser fan is actually turning before assuming anything about the coil itself.",
      "Voltage present at a motor that still isn't moving points at the motor itself rather than what's feeding it.",
    ],
    minimumRequiredEvidence: ["fanMotorAmps", "fanVoltageAtMotor", "liquidSatTempF"],
    measurementRule: (config, cond) => {
      const severity = randInt(20, 35);
      const evapSatF = config.designEvapSatTempF + randFloat(-2, 2);
      const superheatF = config.designSuperheatF + randFloat(-2, 2);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + severity;
      const subcoolingF = config.designSubcoolingF + severity * 0.2 + randFloat(-1, 1);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      return { ...base, fanMotorAmps: 0, fanVoltageAtMotor: randFloat(228, 242) };
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "normal", maxAbsDelta: 3 },
    ],
    reasoning: {
      primaryDiagnosis: "Condenser fan motor electrically open (failed) -- not turning despite the compressor running",
      acceptableDiagnoses: ["condenser fan motor failed", "dead condenser fan motor", "fan motor open/burned out", "condenser fan not running"],
      acceptablePartialDiagnoses: ["condenser fan problem", "outdoor fan electrical issue"],
      differentialDiagnosis: [
        { faultId: "refrig-dirty-condenser", strength: "strong", whyItCouldFit: "Both show elevated head pressure with reduced condenser airflow", evidenceThatRulesItOut: "The fan reads full line voltage at the motor but draws zero current and isn't turning -- a dirty coil would still have a running, current-drawing fan" },
      ],
      minimumConclusion: "Identifies a failed condenser fan motor as the cause, citing voltage present at the motor with zero amp draw and no rotation, alongside the resulting elevated head pressure.",
    },
  },
  {
    id: "elec-weak-run-capacitor",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "beginner",
    complaints: ["Outdoor unit hums but the compressor won't start; the fan doesn't spin on its own either."],
    hints: [
      "A compressor that hums but won't start often has an electrical starting-component issue rather than a mechanical one.",
      "Compare the capacitor's measured value against its rated value before looking anywhere else.",
    ],
    minimumRequiredEvidence: ["capacitorRatedMFD", "capacitorMeasuredMFD"],
    measurementRule: () => {
      const rated = pick([35, 40, 45, 50]);
      return {
        capacitorRatedMFD: rated,
        capacitorMeasuredMFD: randFloat(rated * 0.15, rated * 0.4),
        compressorStartAttempt: "hums, does not start",
        fanSpinsWhenNudged: true,
      };
    },
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Failed or weak run capacitor",
      acceptableDiagnoses: ["bad run capacitor", "weak capacitor", "failed capacitor", "capacitor needs replacing"],
      acceptablePartialDiagnoses: ["electrical starting problem", "capacitor issue suspected"],
      differentialDiagnosis: [
        { faultId: "elec-contactor-failure", strength: "strong", whyItCouldFit: "Both are compressor no-start electrical issues", evidenceThatRulesItOut: "The compressor is humming and attempting to start here, and the fan spins freely when nudged -- a failed contactor would show no attempt at all, since power wouldn't reach the circuit" },
      ],
      minimumConclusion: "Identifies a weak or failed run capacitor as the cause, citing a measured capacitance well below the rated value together with a hum-but-no-start symptom.",
    },
  },
  {
    id: "elec-contactor-failure",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "beginner",
    complaints: ["Outdoor unit does nothing on a call for cooling -- no hum, no fan, nothing."],
    hints: [
      "Check how far the electrical signal actually gets before the compressor circuit loses power.",
      "Voltage present ahead of a component but absent right after it usually means that component isn't passing power through.",
    ],
    minimumRequiredEvidence: ["contactorCoilVoltage", "lineVoltageAtContactor", "loadSideVoltage"],
    measurementRule: () => ({
      contactorCoilVoltage: randFloat(23.5, 24.5),
      lineVoltageAtContactor: randFloat(228, 240),
      loadSideVoltage: 0,
    }),
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Failed contactor -- not passing power through to the compressor/fan circuit despite the coil being energized",
      acceptableDiagnoses: ["failed contactor", "bad contactor", "contactor not passing power", "pitted or welded contactor"],
      acceptablePartialDiagnoses: ["electrical no-start problem", "contactor issue suspected"],
      differentialDiagnosis: [
        { faultId: "elec-weak-run-capacitor", strength: "strong", whyItCouldFit: "Both are compressor no-start electrical issues", evidenceThatRulesItOut: "There's no hum or attempt at all here, and the coil voltage confirms the low-voltage side is fine -- the load side reading zero with the coil energized points at the contacts themselves, not a capacitor" },
      ],
      minimumConclusion: "Identifies a failed contactor as the cause, citing full coil and line voltage present with zero volts on the load side.",
    },
  },
  {
    id: "minisplit-eev-fault",
    appliesTo: ["minisplit_r410a_eev_1p5ton"],
    category: "electrical", difficulty: "advanced",
    complaints: ["Mini-split runs but barely cools, and the outdoor unit sounds like it's working harder than usual."],
    hints: [
      "This looks like a typical starved-evaporator refrigeration pattern -- but this system doesn't use a purely mechanical metering device, so consider what else could produce it.",
      "Compare what the board is commanding the metering device to do against what the device actually appears to be doing.",
    ],
    minimumRequiredEvidence: ["eevCommandedPositionPct", "eevActualPositionFeedbackPct", "suctionSatTempF", "superheatF"],
    measurementRule: (config, cond) => {
      const severity = randInt(10, 18);
      const evapSatF = config.designEvapSatTempF - severity;
      const superheatF = config.designSuperheatF + severity * 1.0 + randFloat(-1, 1);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randFloat(-2, 2);
      const subcoolingF = config.designSubcoolingF + randFloat(-1, 2);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      return { ...base, eevCommandedPositionPct: randInt(70, 100), eevActualPositionFeedbackPct: randInt(15, 30) };
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "high", minAbsDelta: 6 },
    ],
    reasoning: {
      primaryDiagnosis: "EEV not responding to its control signal (stepper motor/drive fault), leaving the valve far more closed than commanded",
      acceptableDiagnoses: ["eev fault", "eev not responding", "eev stuck/stepper motor failure", "electronic expansion valve control fault"],
      acceptablePartialDiagnoses: ["metering device problem", "control fault affecting refrigerant flow"],
      differentialDiagnosis: [
        { faultId: "refrig-restricted-metering", strength: "strong", whyItCouldFit: "Produces an essentially identical low-suction/high-superheat refrigeration pattern", evidenceThatRulesItOut: "The commanded valve position and the actual feedback position disagree substantially -- a physical clog wouldn't show a command/feedback mismatch, since the valve would simply be restricted regardless of what's commanded" },
      ],
      minimumConclusion: "Identifies an EEV control/drive fault as the cause, citing the mismatch between the commanded valve position and its actual feedback position, alongside the resulting starved-evaporator refrigeration pattern.",
    },
  },
  {
    id: "minisplit-communication-fault",
    appliesTo: ["minisplit_r410a_eev_1p5ton"],
    category: "electrical", difficulty: "beginner",
    complaints: ["Mini-split does nothing on a call for cooling -- indoor unit has power but nothing runs, and it's showing a blinking light pattern."],
    hints: [
      "Confirm whether the unit has power at all before assuming a deeper mechanical or refrigeration problem.",
      "An error code is often the fastest way this kind of equipment tells you where to start looking.",
    ],
    minimumRequiredEvidence: ["controlPowerPresent", "errorCodeBlinking", "compressorResponse"],
    measurementRule: () => ({
      controlPowerPresent: true,
      errorCodeBlinking: "indoor-outdoor communication fault code",
      compressorResponse: "none",
      indoorFanResponse: "none",
    }),
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Indoor-outdoor communication fault (or an associated control board fault reporting the same code)",
      acceptableDiagnoses: ["communication error", "comm fault between indoor and outdoor units", "control board communication problem"],
      acceptablePartialDiagnoses: ["control board fault", "electrical/control problem"],
      differentialDiagnosis: [
        { faultId: "elec-contactor-failure", strength: "weak", whyItCouldFit: "Both are total no-run electrical complaints", evidenceThatRulesItOut: "This unit has confirmed control power and is displaying a specific communication-fault code, which a simple contactor failure wouldn't produce" },
      ],
      minimumConclusion: "Identifies a communication/control fault as the cause, citing confirmed control power together with a communication-specific fault code and no compressor or fan response.",
    },
  },
  {
    id: "rtu-economizer-fault",
    appliesTo: ["rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "expert",
    complaints: ["Tenant says the space feels cold and clammy even though the thermostat is set to cool and it's a mild day outside."],
    hints: [
      "This refrigeration-side pattern can look identical to a plain airflow problem at the indoor coil -- the answer isn't going to come from the suction/superheat numbers alone.",
      "Consider what's actually mixing into the airstream before it ever reaches the evaporator, and whether that matches what the outdoor conditions alone would explain.",
    ],
    minimumRequiredEvidence: ["economizerDamperPositionPct", "mixedAirTempF", "suctionSatTempF", "superheatF", "subcoolingF"],
    measurementRule: (config, cond) => {
      const severity = randInt(10, 18);
      const evapSatF = config.designEvapSatTempF - severity;
      const superheatF = config.designSuperheatF + severity * 0.7 + randFloat(-1, 1);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randFloat(-2, 2);
      const subcoolingF = config.designSubcoolingF + randFloat(-1.5, 1.5);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      const damperPct = randInt(70, 100);
      const mixedAirTempF = Math.round(cond.outdoorTempF * (damperPct / 100) + cond.returnAirTempF * (1 - damperPct / 100));
      return { ...base, economizerDamperPositionPct: damperPct, mixedAirTempF };
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "high", minAbsDelta: 4 },
      { measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "normal", maxAbsDelta: 3 },
    ],
    reasoning: {
      primaryDiagnosis: "Economizer damper stuck open too far, feeding excess cold outdoor air into the coil and starving it of the load it's designed around",
      acceptableDiagnoses: ["economizer fault", "economizer damper stuck open", "economizer bringing in too much outdoor air"],
      acceptablePartialDiagnoses: ["outdoor air/mixed air problem", "control fault affecting the economizer"],
      differentialDiagnosis: [
        { faultId: "refrig-low-airflow-evap", strength: "weak", whyItCouldFit: "Produces a nearly identical low-suction/high-superheat/normal-subcooling refrigeration pattern", evidenceThatRulesItOut: "The economizer damper position and mixed-air temperature are the only readings that separate the two here -- a damper open well beyond what the outdoor conditions call for, feeding unusually cold mixed air, points at the economizer rather than a filter or blower" },
      ],
      minimumConclusion: "Identifies the economizer as the cause, specifically citing the damper position and abnormally cold mixed-air temperature -- not just the refrigeration-side numbers, which alone would also fit a plain airflow restriction.",
    },
  },

  /* ---------------- FURNACE ---------------- */
  {
    id: "furnace-no-power",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "electrical", difficulty: "beginner",
    complaints: ["Furnace does nothing on a call for heat -- no fan, no ignition attempt at all."],
    hints: [
      "Notice how far the unit gets into its startup sequence before nothing happens at all.",
      "If the transformer itself is confirmed good but nothing downstream has power, where between the transformer and the board could that stop?",
    ],
    minimumRequiredEvidence: ["transformerOutputVAC", "boardRCVAC"],
    measurementRule: () => ({
      transformerOutputVAC: randFloat(23.8, 24.6),
      boardRCVAC: 0,
      doorSwitchSeated: true,
    }),
    sequenceImpact: { blocksAtStage: "call_for_heat" },
    validationChecks: [],
    reasoning: {
      // Evidence proves the low-voltage circuit isn't reaching the board -- it does
      // NOT prove why (blown fuse vs. shorted wire vs. something else). The required
      // answer is scoped to what's actually provable; a specific unproven cause
      // (e.g. "shorted thermostat wire") is not required for full credit.
      primaryDiagnosis: "Low-voltage power fault preventing the board from ever receiving power (commonly a blown control-board fuse)",
      acceptableDiagnoses: ["blown fuse", "blown control board fuse", "low voltage fuse blown", "board isn't getting power", "no power reaching the control board"],
      acceptablePartialDiagnoses: ["low voltage circuit problem", "control circuit not powered", "electrical fault upstream of the board"],
      plausibleUnprovenCause: "A shorted thermostat wire is a common reason this happens, but this scenario's evidence doesn't establish that specific cause -- don't require it for credit.",
      differentialDiagnosis: [
        { faultId: "furnace-dirty-flame-sensor", strength: "strong", whyItCouldFit: "Both are no-heat calls", evidenceThatRulesItOut: "Flame sensor faults happen after ignition is attempted -- this unit never gets that far" },
        { faultId: "furnace-igniter-failure", strength: "strong", whyItCouldFit: "Both are no-heat calls", evidenceThatRulesItOut: "An igniter fault would still show the inducer running and draft proving -- here nothing happens at all, even the inducer" },
      ],
      minimumConclusion: "Identifies a low-voltage power fault preventing the board from starting the sequence at all -- without requiring a specific unproven root cause like a shorted wire.",
    },
  },
  {
    id: "furnace-igniter-failure",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "electrical", difficulty: "intermediate",
    complaints: ["Furnace's inducer runs fine, but it never lights -- no flame at all, every cycle."],
    hints: [
      "The draft/inducer stage is clearly working -- so where in the sequence does the process actually stall?",
      "If there's voltage right at the ignition component but it still won't do its job, think about what a direct resistance check across the component itself would tell you.",
    ],
    minimumRequiredEvidence: ["igniterVoltagePresentVAC", "igniterGlowObserved", "igniterResistanceOhms"],
    measurementRule: () => ({
      igniterVoltagePresentVAC: randFloat(118, 122),
      igniterGlowObserved: false,
      igniterResistanceOhms: "OL (open)",
    }),
    sequenceImpact: { blocksAtStage: "ignition_trial" },
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Failed hot surface igniter (open element)",
      acceptableDiagnoses: ["failed igniter", "open igniter", "igniter not glowing", "hot surface igniter failure", "bad igniter"],
      acceptablePartialDiagnoses: ["ignition problem", "igniter circuit issue"],
      differentialDiagnosis: [
        { faultId: "furnace-no-power", strength: "strong", whyItCouldFit: "Both are no-heat complaints", evidenceThatRulesItOut: "The draft/inducer stage successfully proves here, meaning the unit got well past the point a total power fault would stop it" },
        { faultId: "furnace-dirty-flame-sensor", strength: "strong", whyItCouldFit: "Both are ignition-related no-heat complaints", evidenceThatRulesItOut: "There's no flame at all here, ever -- a flame sensor fault requires a flame to have existed first" },
      ],
      minimumConclusion: "Identifies the igniter as the cause, citing full voltage present at the element together with no observed glow and an open resistance reading.",
    },
  },
  {
    id: "furnace-pressure-switch-stuck",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "combustion", difficulty: "advanced",
    complaints: ["Furnace's inducer kicks on, but the burners never light -- it just runs the inducer and locks out."],
    hints: [
      "All three of these 'stuck before ignition' calls can look similar at first -- the inducer's own electrical behavior is one clue, and the actual static pressure reading is another.",
      "If the inducer motor itself is drawing a normal amount of current, the problem is more likely with how the draft is being sensed than with the motor producing draft.",
    ],
    minimumRequiredEvidence: ["inducerRunning", "inducerAmpsDraw", "ventStaticPressureInWC", "pressureSwitchState"],
    measurementRule: (config) => ({
      inducerRunning: true,
      inducerAmpsDraw: randFloat(config.normalInducerAmpsRange[0], config.normalInducerAmpsRange[1]),
      ventStaticPressureInWC: randFloat(config.normalVentStaticRangeInWC[0], config.normalVentStaticRangeInWC[1]),
      pressureSwitchState: "open (never closes despite normal draft)",
    }),
    sequenceImpact: { blocksAtStage: "draft_proving" },
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Pressure switch itself failed/stuck open (not sensing an actual draft problem)",
      acceptableDiagnoses: ["stuck pressure switch", "failed draft pressure switch", "pressure switch not closing despite normal draft"],
      acceptablePartialDiagnoses: ["draft proving circuit problem", "pressure switch suspected"],
      differentialDiagnosis: [
        { faultId: "furnace-blocked-venting", strength: "strong", whyItCouldFit: "Produces the identical 'stuck at draft proving' symptom", evidenceThatRulesItOut: "Both inducer amp draw and static pressure read within their normal ranges here -- an actual vent restriction would push the inducer to draw more current while achieving a lower static pressure reading, which isn't seen" },
        { faultId: "furnace-inducer-electrical-failure", strength: "strong", whyItCouldFit: "Also stops the sequence at draft proving", evidenceThatRulesItOut: "The inducer is confirmed running with a normal amp draw here -- an electrically dead motor wouldn't run or draw current at all" },
      ],
      minimumConclusion: "Identifies the pressure switch itself as the cause, citing normal inducer amp draw and normal static pressure alongside a switch that still won't close.",
    },
  },
  {
    id: "furnace-blocked-venting",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "combustion", difficulty: "advanced",
    complaints: ["Furnace inducer runs noticeably loud, but the burners never light and it locks out every time."],
    hints: [
      "Compare how hard the inducer motor is working against what the static pressure reading is actually showing.",
      "A motor working harder than normal while still not achieving the expected draft reading points somewhere other than the motor or the switch itself.",
    ],
    minimumRequiredEvidence: ["inducerRunning", "inducerAmpsDraw", "ventStaticPressureInWC", "pressureSwitchState"],
    measurementRule: (config) => ({
      inducerRunning: true,
      inducerAmpsDraw: randFloat(config.normalInducerAmpsRange[1] + 0.2, config.normalInducerAmpsRange[1] + 0.6),
      ventStaticPressureInWC: randFloat(config.normalVentStaticRangeInWC[0] - 0.15, config.normalVentStaticRangeInWC[0] - 0.05),
      pressureSwitchState: "open (insufficient draft differential achieved)",
    }),
    sequenceImpact: { blocksAtStage: "draft_proving" },
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Restricted venting/flue (blocked exhaust) preventing the inducer from achieving proving draft",
      acceptableDiagnoses: ["blocked vent", "restricted venting", "flue obstruction", "vent pipe blocked or restricted"],
      acceptablePartialDiagnoses: ["venting/draft problem", "combustion air or exhaust restriction suspected"],
      differentialDiagnosis: [
        { faultId: "furnace-pressure-switch-stuck", strength: "strong", whyItCouldFit: "Produces the identical 'stuck at draft proving' symptom", evidenceThatRulesItOut: "Inducer amp draw is elevated above normal here and static pressure reads below the normal range -- a bad switch alone wouldn't change either of those readings" },
        { faultId: "furnace-inducer-electrical-failure", strength: "strong", whyItCouldFit: "Also stops the sequence at draft proving", evidenceThatRulesItOut: "The inducer is running and drawing current here, just working harder than normal -- an electrically dead motor wouldn't run at all" },
      ],
      minimumConclusion: "Identifies a vent/flue restriction as the cause, citing elevated inducer amp draw together with a below-normal static pressure reading -- the motor working harder but still not achieving proving draft.",
    },
  },
  {
    id: "furnace-inducer-electrical-failure",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "electrical", difficulty: "advanced",
    complaints: ["Furnace does nothing but a faint click when it calls for heat -- no inducer sound at all, no ignition."],
    hints: [
      "Before assuming a stuck switch or a blocked vent, check whether the inducer is actually turning at all.",
      "Zero current draw from a motor that's supposed to be running usually points to the motor circuit itself, not what's downstream of it.",
    ],
    minimumRequiredEvidence: ["inducerRunning", "inducerAmpsDraw", "pressureSwitchState"],
    measurementRule: () => ({
      inducerRunning: false,
      inducerAmpsDraw: 0,
      pressureSwitchState: "open (no draft present -- inducer not running)",
    }),
    sequenceImpact: { blocksAtStage: "draft_proving" },
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Inducer motor electrically failed (open winding or dead run capacitor) -- not running at all",
      acceptableDiagnoses: ["dead inducer motor", "inducer motor failed", "inducer not running", "open inducer motor winding"],
      acceptablePartialDiagnoses: ["inducer electrical problem", "draft motor issue suspected"],
      differentialDiagnosis: [
        { faultId: "furnace-pressure-switch-stuck", strength: "strong", whyItCouldFit: "Produces the identical 'stuck at draft proving' symptom", evidenceThatRulesItOut: "The inducer draws zero current here and isn't turning at all -- a bad switch alone wouldn't stop the motor from running" },
        { faultId: "furnace-blocked-venting", strength: "strong", whyItCouldFit: "Also stops the sequence at draft proving", evidenceThatRulesItOut: "A blocked vent would still show the motor running (harder than normal); here it isn't running at all" },
        { faultId: "furnace-no-power", strength: "moderate", whyItCouldFit: "Also an early-sequence no-response fault", evidenceThatRulesItOut: "This is scoped to just the inducer circuit rather than a total board power loss -- confirm whether other board functions/indicators still respond before settling on this over a full power fault" },
      ],
      minimumConclusion: "Identifies a dead inducer motor as the cause, citing zero amp draw and no rotation despite a call for heat reaching the draft-proving stage.",
    },
  },
  {
    id: "furnace-dirty-flame-sensor",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "combustion", difficulty: "intermediate",
    complaints: ["Furnace lights normally, runs for under a minute, then shuts off -- and repeats every few minutes."],
    hints: [
      "Pay attention to exactly which stage of the sequence this furnace reaches before shutting down.",
      "A flame rectification signal is normally a few microamps DC -- think about what a reading well under that typical range, on an otherwise-normal-looking flame, suggests about how well the flame is being sensed versus how well it's actually burning.",
    ],
    minimumRequiredEvidence: ["flameProveTimeSec", "flameSensorMicroampsDC"],
    measurementRule: () => ({
      flameProveTimeSec: randInt(25, 50),
      flameSensorMicroampsDC: randFloat(0.3, 0.8),
    }),
    sequenceImpact: { degradesAtStage: "flame_proving" },
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Weak or dirty flame sensor losing microamp signal",
      acceptableDiagnoses: ["dirty flame sensor", "weak flame sensor signal", "flame sensor needs cleaning", "flame rectification signal too low"],
      acceptablePartialDiagnoses: ["flame sensing problem", "flame proving fault", "sensor rod issue"],
      differentialDiagnosis: [
        { faultId: "furnace-cracked-heat-exchanger", strength: "strong", whyItCouldFit: "Both involve flame behavior", evidenceThatRulesItOut: "A cracked heat exchanger typically doesn't cause flame-loss shutdowns -- the furnace usually keeps running instead of dropping out mid-cycle" },
        { faultId: "furnace-no-power", strength: "strong", whyItCouldFit: "Both are recurring no-heat complaints", evidenceThatRulesItOut: "This unit successfully ignites every cycle -- a power/fuse fault would never reach ignition in the first place" },
      ],
      minimumConclusion: "Identifies the flame sensor (weak/dirty, insufficient microamp signal) as the cause of the flame-proving dropout -- not the igniter, gas valve, or heat exchanger.",
    },
  },
  {
    id: "furnace-cracked-heat-exchanger",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "combustion", difficulty: "expert",
    complaints: ["Homeowner reports headaches near the furnace and a faint metallic smell at the return; they mention the flame looked a little unsteady when they peeked at it."],
    hints: [
      "This furnace completes its cycle without any lockouts -- so think about what kind of fault wouldn't trip a safety switch.",
      "Consider what's shared between the combustion side of the furnace and the air the blower pushes into the house.",
    ],
    minimumRequiredEvidence: ["ambientCOppm"],
    measurementRule: () => ({
      ambientCOppm: randInt(35, 120),
    }),
    sequenceImpact: null,
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Cracked heat exchanger allowing combustion gases into the airstream",
      acceptableDiagnoses: ["cracked heat exchanger", "heat exchanger is leaking combustion gases", "heat exchanger failure"],
      acceptablePartialDiagnoses: ["combustion safety issue", "CO problem", "heat exchanger suspected"],
      differentialDiagnosis: [
        { faultId: "furnace-dirty-flame-sensor", strength: "moderate", whyItCouldFit: "Both involve an unstable-looking flame", evidenceThatRulesItOut: "This unit completes its full cycle with no flame-proving fault logged -- a sensor problem more typically shows flame-loss shutdowns, which aren't present here" },
      ],
      minimumConclusion: "Identifies a cracked heat exchanger as a combustion-safety issue, citing elevated ambient CO together with a complete, unlocked-out cycle -- this is a safety concern, not a routine tune-up item.",
    },
  },

  /* ================= BATCH 2 -- CONTENT EXPANSION ================= */

  /* ---------------- FURNACE (batch 2) ---------------- */
  {
    id: "furnace-gas-valve-fails-to-open",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "combustion", difficulty: "intermediate",
    complaints: ["Furnace's igniter glows fully every cycle, but there's never any gas smell or flame -- it just locks out after a few tries."],
    hints: [
      "The igniter itself is confirmed working here -- so the sequence is stalling somewhere after that point.",
      "Voltage reaching a valve is not the same as the valve actually opening -- think about what would tell you the difference.",
    ],
    minimumRequiredEvidence: ["igniterGlowObserved", "gasValveVoltageAtValve", "gasSmellDetected"],
    measurementRule: () => ({
      igniterGlowObserved: true,
      igniterResistanceOhms: randFloat(40, 60),
      gasValveVoltageAtValve: randFloat(23.5, 24.5),
      gasSmellDetected: false,
    }),
    sequenceImpact: { blocksAtStage: "ignition_trial" },
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Gas valve not opening despite receiving a valid signal to open (failed valve or valve circuit)",
      acceptableDiagnoses: ["gas valve not opening", "failed gas valve", "gas valve won't open", "bad gas valve"],
      acceptablePartialDiagnoses: ["gas valve problem", "ignition problem downstream of the igniter"],
      differentialDiagnosis: [
        { faultId: "furnace-igniter-failure", strength: "strong", whyItCouldFit: "Both are ignition-trial failures", evidenceThatRulesItOut: "The igniter is confirmed glowing and reads a normal resistance here" },
        { faultId: "furnace-dirty-flame-sensor", strength: "strong", whyItCouldFit: "Both are ignition-related no-heat complaints", evidenceThatRulesItOut: "No flame ever establishes at all -- a flame sensor fault requires a flame to have existed first" },
        { faultId: "furnace-low-gas-pressure", strength: "moderate", whyItCouldFit: "Both involve gas delivery", evidenceThatRulesItOut: "There's no gas smell at all here, meaning no gas is reaching the burners whatsoever, not just a weak flow" },
      ],
      minimumConclusion: "Identifies the gas valve itself (or its immediate circuit) as the cause, citing a healthy igniter with voltage confirmed present at the valve but no gas smell or flame ever establishing.",
    },
  },
  {
    id: "furnace-low-gas-pressure",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "combustion", difficulty: "intermediate",
    complaints: ["Furnace lights, but the flame looks weak and yellow-tinged, and the house never quite gets as warm as it used to."],
    hints: [
      "The flame is establishing and holding just fine -- so this isn't a sensing or proving problem.",
      "Compare the manifold pressure reading against what the nameplate/spec calls for before looking at anything mechanical.",
    ],
    minimumRequiredEvidence: ["manifoldGasPressureInWC", "measuredTempRiseF"],
    measurementRule: (config) => ({
      manifoldGasPressureInWC: randFloat(2.4, 2.9),
      measuredTempRiseF: Math.round(config.temperatureRiseRangeF[0] - randFloat(3, 8)),
    }),
    sequenceImpact: null,
    validationChecks: [],
    extraValidation: (config, cond, m) => {
      const notes = [];
      if (config.designManifoldPressureInWC - m.manifoldGasPressureInWC < 0.4) notes.push("manifold pressure not low enough to be distinguishable from spec");
      if (m.measuredTempRiseF >= config.temperatureRiseRangeF[0]) notes.push("temp rise not below normal range");
      return notes;
    },
    reasoning: {
      primaryDiagnosis: "Low gas supply/manifold pressure causing incomplete combustion and reduced heat output",
      acceptableDiagnoses: ["low gas pressure", "low manifold pressure", "gas pressure too low", "undersized/restricted gas supply"],
      acceptablePartialDiagnoses: ["combustion quality problem", "gas supply issue suspected"],
      differentialDiagnosis: [
        { faultId: "furnace-dirty-flame-sensor", strength: "moderate", whyItCouldFit: "Both are flame-related complaints", evidenceThatRulesItOut: "The flame establishes and holds with no flame-loss shutdowns logged here -- the flame's quality, not the sensing of it, is the issue" },
        { faultId: "furnace-restricted-ductwork", strength: "weak", whyItCouldFit: "Both can reduce comfort", evidenceThatRulesItOut: "Temperature rise here is below the normal range, not above -- a ductwork restriction pushes rise higher, not lower" },
      ],
      minimumConclusion: "Identifies low gas/manifold pressure as the cause, citing a manifold pressure reading below spec together with a measured temperature rise below the normal range.",
    },
  },
  {
    id: "furnace-repeated-ignition-retries",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "combustion", difficulty: "expert",
    complaints: ["Furnace tries to light several times before it finally either catches or locks out -- customer says it's been getting worse over the past week."],
    hints: [
      "This furnace does eventually light -- so whatever's wrong isn't a hard failure of any single component.",
      "A resistance reading that's elevated but not infinite, combined with a trend getting worse over time, points toward a component that's degrading rather than one that's already dead.",
    ],
    minimumRequiredEvidence: ["ignitionAttemptsBeforeSuccess", "igniterResistanceOhms", "lockoutHistoryLast30Days"],
    measurementRule: () => ({
      ignitionAttemptsBeforeSuccess: randInt(2, 4),
      igniterResistanceOhms: randFloat(58, 78),
      flameEstablishedEventually: true,
      lockoutHistoryLast30Days: randInt(2, 5),
    }),
    sequenceImpact: null,
    validationChecks: [],
    extraValidation: (config, cond, m) => (m.ignitionAttemptsBeforeSuccess < 2 ? ["needs at least 2 attempts to demonstrate the pattern"] : []),
    reasoning: {
      primaryDiagnosis: "Igniter marginally weak/degrading -- warming slowly and inconsistently without yet being fully open",
      acceptableDiagnoses: ["weak/degrading igniter", "igniter marginal, warming too slowly", "aging igniter causing inconsistent ignition"],
      acceptablePartialDiagnoses: ["ignition system degrading", "intermittent ignition problem suspected"],
      differentialDiagnosis: [
        { faultId: "furnace-igniter-failure", strength: "strong", whyItCouldFit: "Both are igniter-related", evidenceThatRulesItOut: "This igniter does eventually glow enough to light -- a fully open igniter would never light at all, on any attempt" },
        { faultId: "furnace-low-gas-pressure", strength: "moderate", whyItCouldFit: "Both can produce inconsistent-looking ignition", evidenceThatRulesItOut: "Once lit, flame and temperature rise are normal here -- the inconsistency is specifically at the ignition-trial stage, not sustained combustion quality" },
        { faultId: "furnace-gas-valve-fails-to-open", strength: "moderate", whyItCouldFit: "Both can look like ignition trouble", evidenceThatRulesItOut: "Gas clearly does reach the burners once ignition eventually succeeds -- a valve that truly failed to open would never establish flame at all" },
      ],
      minimumConclusion: "Identifies a marginally weak/degrading igniter as the cause, citing multiple ignition attempts needed before success, a resistance reading in a marginal-but-not-open range, and a worsening recent lockout history -- reasoning from the pattern across attempts rather than any single reading.",
    },
  },
  {
    id: "furnace-limit-switch-false-trip",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "electrical", difficulty: "advanced",
    complaints: ["Furnace runs for a while, then locks out on a limit fault -- but the house never actually gets uncomfortably warm before it happens."],
    hints: [
      "Before assuming the furnace is actually overheating, check whether the temperature rise reading agrees with that.",
      "A safety switch tripping when the condition it's supposed to detect isn't actually present usually points at the switch or its wiring, not real overheat.",
    ],
    minimumRequiredEvidence: ["measuredTempRiseF", "limitCircuitContinuity"],
    measurementRule: (config) => ({
      measuredTempRiseF: Math.round((config.temperatureRiseRangeF[0] + config.temperatureRiseRangeF[1]) / 2),
      limitCircuitContinuity: "intermittent/open under vibration",
      lockoutCode: "high limit",
    }),
    sequenceImpact: null,
    validationChecks: [],
    extraValidation: (config, cond, m) => {
      const notes = [];
      if (m.measuredTempRiseF < config.temperatureRiseRangeF[0] || m.measuredTempRiseF > config.temperatureRiseRangeF[1]) notes.push("temp rise must read within normal range to prove this isn't a real overheat");
      return notes;
    },
    reasoning: {
      primaryDiagnosis: "Limit circuit wiring/switch fault causing a nuisance trip -- not an actual overheat condition",
      acceptableDiagnoses: ["false limit trip", "limit switch/wiring fault, not a real overheat", "nuisance limit trip"],
      acceptablePartialDiagnoses: ["limit circuit problem", "electrical fault causing lockout"],
      differentialDiagnosis: [
        { faultId: "furnace-restricted-ductwork", strength: "strong", whyItCouldFit: "Both produce limit lockouts", evidenceThatRulesItOut: "Temperature rise reads within the normal range here -- a real airflow-caused overheat would push rise above spec" },
        { faultId: "furnace-blower-motor-electrical-fault", strength: "strong", whyItCouldFit: "Both can involve a limit-related lockout", evidenceThatRulesItOut: "The blower is confirmed running normally here; a dead blower produces a far more extreme temp rise and a much faster, more severe trip" },
      ],
      minimumConclusion: "Identifies the limit circuit itself (wiring/switch) as the cause, citing a measured temperature rise within normal range despite the lockout -- ruling out an actual overheat condition.",
    },
  },
  {
    id: "furnace-restricted-ductwork",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "airflow", difficulty: "intermediate",
    complaints: ["Furnace runs, but one part of the house barely gets any heat, and it cycles on the limit switch more than it used to."],
    hints: [
      "The blower motor itself is running -- so think about what's happening to the air after it leaves the blower.",
      "A motor working harder than normal while airflow still seems inadequate points at a restriction downstream, not the motor itself.",
    ],
    minimumRequiredEvidence: ["measuredTempRiseF", "blowerMotorAmps"],
    measurementRule: (config) => ({
      measuredTempRiseF: Math.round(config.temperatureRiseRangeF[1] + randFloat(8, 18)),
      blowerMotorAmps: randFloat(6.5, 7.5),
      blowerRunning: true,
    }),
    sequenceImpact: null,
    validationChecks: [],
    extraValidation: (config, cond, m) => {
      const notes = [];
      if (m.measuredTempRiseF <= config.temperatureRiseRangeF[1]) notes.push("temp rise must exceed normal range");
      if (m.blowerMotorAmps <= config.normalBlowerAmpsRange[1]) notes.push("blower amps must exceed normal range");
      return notes;
    },
    reasoning: {
      primaryDiagnosis: "Restricted ductwork limiting airflow, causing elevated temperature rise",
      acceptableDiagnoses: ["restricted ductwork", "duct airflow restriction", "undersized/blocked ducts causing high rise"],
      acceptablePartialDiagnoses: ["airflow restriction downstream of the blower", "excessive temperature rise, cause not yet pinpointed"],
      differentialDiagnosis: [
        { faultId: "furnace-blower-capacitor-weak", strength: "strong", whyItCouldFit: "Both can reduce effective airflow", evidenceThatRulesItOut: "Blower amp draw here is elevated, not reduced -- a weak capacitor makes the motor less effective and typically draws less current while running slow, the opposite pattern" },
        { faultId: "furnace-limit-switch-false-trip", strength: "strong", whyItCouldFit: "Both can involve limit lockouts", evidenceThatRulesItOut: "Temperature rise genuinely reads above the normal range here, confirming a real overheat condition rather than a nuisance trip" },
      ],
      minimumConclusion: "Identifies restricted ductwork as the cause, citing temperature rise above the normal range together with blower amp draw elevated above its normal range -- the motor working harder against restriction.",
    },
  },
  {
    id: "furnace-blower-capacitor-weak",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "electrical", difficulty: "intermediate",
    complaints: ["Furnace runs, but airflow at the registers feels weak, and the house takes longer to warm up than it used to."],
    hints: [
      "The blower is running, just not effectively -- an electrical component that helps a motor start and run efficiently is worth checking first.",
      "Compare the capacitor's measured value to its rating, the same way you would on the compressor side of an AC system.",
    ],
    minimumRequiredEvidence: ["blowerCapacitorRatedMFD", "blowerCapacitorMeasuredMFD", "blowerMotorAmps"],
    measurementRule: (config) => {
      const rated = pick([5, 7.5, 10]);
      return {
        blowerCapacitorRatedMFD: rated,
        blowerCapacitorMeasuredMFD: randFloat(rated * 0.2, rated * 0.45),
        blowerMotorAmps: randFloat(2.5, 3.2),
        measuredTempRiseF: Math.round(config.temperatureRiseRangeF[1] + randFloat(2, 10)),
      };
    },
    sequenceImpact: null,
    validationChecks: [],
    extraValidation: (config, cond, m) => (m.blowerMotorAmps >= config.normalBlowerAmpsRange[0] ? ["blower amps must read below normal range"] : []),
    reasoning: {
      primaryDiagnosis: "Weak or failed blower motor run capacitor, reducing blower speed and airflow",
      acceptableDiagnoses: ["weak blower capacitor", "failed blower run capacitor", "blower capacitor needs replacing"],
      acceptablePartialDiagnoses: ["blower motor problem", "airflow reduced, electrical cause suspected"],
      differentialDiagnosis: [
        { faultId: "furnace-restricted-ductwork", strength: "strong", whyItCouldFit: "Both reduce effective delivered airflow", evidenceThatRulesItOut: "Blower amp draw is below normal here rather than elevated -- a physical restriction makes the motor work harder, not weaker" },
      ],
      minimumConclusion: "Identifies a weak blower run capacitor as the cause, citing measured capacitance well below rated value together with blower amp draw below its normal range.",
    },
  },
  {
    id: "furnace-blower-motor-electrical-fault",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "electrical", difficulty: "beginner",
    complaints: ["Furnace ignites and runs briefly, but shuts down almost immediately on a lockout -- and no air is coming out of the registers at all."],
    hints: [
      "Confirm whether the blower is actually turning before assuming a duct or capacitor problem.",
      "No current draw at all from a motor that should be running points to the motor circuit itself.",
    ],
    minimumRequiredEvidence: ["blowerRunning", "blowerMotorAmps"],
    measurementRule: () => ({
      blowerRunning: false,
      blowerMotorAmps: 0,
    }),
    sequenceImpact: { degradesAtStage: "run" },
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Blower motor not running at all (electrically dead), causing an immediate overheat/lockout once the burners fire",
      acceptableDiagnoses: ["dead blower motor", "blower motor not running", "blower motor electrically failed"],
      acceptablePartialDiagnoses: ["blower electrical problem", "no airflow during run stage"],
      differentialDiagnosis: [
        { faultId: "furnace-restricted-ductwork", strength: "strong", whyItCouldFit: "Both involve inadequate airflow during run", evidenceThatRulesItOut: "The blower isn't running at all here -- zero amp draw -- rather than running but restricted downstream" },
        { faultId: "furnace-limit-switch-false-trip", strength: "strong", whyItCouldFit: "Both can end in a lockout", evidenceThatRulesItOut: "There's a real and severe airflow loss here, not a nuisance trip under otherwise-normal conditions" },
      ],
      minimumConclusion: "Identifies a dead blower motor as the cause, citing zero amp draw and no airflow immediately after the burners fire, leading to a fast lockout.",
    },
  },
  {
    id: "furnace-intermittent-thermostat-wiring",
    appliesTo: ["furnace_80afue_hsi_singlestage"],
    category: "electrical", difficulty: "advanced",
    complaints: ["Furnace sometimes shuts off mid-cycle on its own, then comes back on a few minutes later -- happens a few times a day, not every cycle."],
    hints: [
      "An intermittent problem often won't show up on every single check -- what does the physical condition of the wiring tell you, even between drops?",
      "If R to C stays rock-solid but the call itself comes and goes, think about what's downstream of the transformer rather than the transformer itself.",
    ],
    minimumRequiredEvidence: ["rToCVAC", "thermostatWireConnectionCondition"],
    measurementRule: () => ({
      rToCVAC: randFloat(24.0, 24.6),
      rToWDuringCallSnapshot: pick(["24.2 VAC (call present)", "0 VAC (call dropped momentarily)"]),
      thermostatWireConnectionCondition: "visibly corroded/loose at one splice",
    }),
    sequenceImpact: null,
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Intermittent low-voltage thermostat wiring connection causing the call for heat to drop out randomly",
      acceptableDiagnoses: ["intermittent thermostat wiring fault", "loose/corroded thermostat wire connection", "intermittent low voltage connection"],
      acceptablePartialDiagnoses: ["intermittent electrical/control problem", "wiring issue suspected"],
      differentialDiagnosis: [
        { faultId: "furnace-limit-switch-false-trip", strength: "moderate", whyItCouldFit: "Both are electrical faults causing unexpected shutdowns", evidenceThatRulesItOut: "This presents as the call-for-heat signal itself dropping (R to W), not a limit lockout code -- a different part of the circuit" },
      ],
      minimumConclusion: "Identifies an intermittent thermostat wiring connection as the cause, citing a visibly corroded/loose splice together with the call-for-heat signal observed dropping on at least one snapshot, even though transformer output stays steady.",
    },
  },

  /* ---------------- AC / RTU ELECTRICAL (batch 2, harder) ---------------- */
  {
    id: "elec-low-voltage-wiring-fault",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "intermediate",
    complaints: ["Thermostat shows a valid cooling call, but the outdoor unit never responds at all -- no hum, no click, nothing."],
    hints: [
      "Confirm the low-voltage signal is actually reaching the outdoor unit before assuming anything about the contactor itself.",
      "If jumping the signal directly at the outdoor unit makes it run, the equipment isn't the problem.",
    ],
    minimumRequiredEvidence: ["rToCAtIndoorBoardVAC", "rToYAtOutdoorUnitVAC", "jumpingRToYAtOutdoorUnit"],
    measurementRule: () => ({
      rToCAtIndoorBoardVAC: randFloat(24.0, 24.6),
      rToYAtOutdoorUnitVAC: 0,
      jumpingRToYAtOutdoorUnit: "contactor engages immediately",
    }),
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Low-voltage Y signal not reaching the outdoor unit (wiring fault between the control circuit and the outdoor unit) -- the outdoor equipment itself is fine",
      acceptableDiagnoses: ["Y signal not reaching outdoor unit", "low voltage wiring fault to outdoor unit", "broken/disconnected Y wire"],
      acceptablePartialDiagnoses: ["control signal problem", "wiring issue between indoor and outdoor"],
      differentialDiagnosis: [
        { faultId: "elec-contactor-failure", strength: "strong", whyItCouldFit: "Both are total no-response electrical faults", evidenceThatRulesItOut: "Jumping R to Y directly at the outdoor unit makes the contactor engage immediately -- proving the contactor and everything downstream of it is fine" },
      ],
      minimumConclusion: "Identifies a broken/disconnected Y-wire connection as the cause, citing confirmed transformer output at the board, zero volts at the outdoor unit's Y terminal, and the contactor engaging immediately once jumped directly.",
    },
  },
  {
    id: "elec-compressor-winding-open",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "advanced",
    complaints: ["Outdoor fan runs normally, but the compressor never starts -- not even a hum."],
    hints: [
      "Rule out the capacitor and the contactor first -- both check out fine here.",
      "Open readings on two of the three winding-pair combinations, but a real reading on the third, point to which specific internal connection has failed.",
    ],
    minimumRequiredEvidence: ["commonToRunOhms", "commonToStartOhms", "runToStartOhms", "contactorEngaged", "runCapacitorReading"],
    measurementRule: () => ({
      commonToRunOhms: "OL (open)",
      commonToStartOhms: "OL (open)",
      runToStartOhms: randFloat(3.5, 6.5),
      contactorEngaged: true,
      runCapacitorReading: "within spec",
    }),
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Compressor winding open (internal electrical failure) -- not a capacitor or contactor issue",
      acceptableDiagnoses: ["open compressor winding", "compressor electrically failed", "internal compressor open"],
      acceptablePartialDiagnoses: ["compressor electrical problem", "compressor not receiving/using power correctly"],
      differentialDiagnosis: [
        { faultId: "elec-weak-run-capacitor", strength: "strong", whyItCouldFit: "Both are compressor no-start electrical issues", evidenceThatRulesItOut: "The capacitor tests within spec here and there's no hum or start attempt at all -- a weak capacitor case still shows the compressor humming and trying" },
        { faultId: "elec-contactor-failure", strength: "strong", whyItCouldFit: "Both are compressor no-start electrical issues", evidenceThatRulesItOut: "The contactor is confirmed engaged here, and the fan proves the control circuit is fine" },
      ],
      minimumConclusion: "Identifies an open compressor winding as the cause, citing open readings from common to both run and start with a valid reading only across run-to-start, alongside a confirmed-engaged contactor and a capacitor that tests fine.",
    },
  },
  {
    id: "elec-highpressure-protection-trip",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "advanced",
    complaints: ["System trips off on a high-pressure fault a few minutes into every cooling call; the outdoor coil looks visibly caked with debris."],
    hints: [
      "A protection trip is a symptom of something else, not the diagnosis by itself -- what's actually causing the pressure to get that high?",
      "Confirm the fan is actually moving air before looking anywhere else on the high side.",
    ],
    minimumRequiredEvidence: ["liquidSatTempF", "condenserFanAmps", "highPressureSwitchState"],
    measurementRule: (config, cond) => {
      const evapSatF = config.designEvapSatTempF + randFloat(-2, 2);
      const superheatF = config.designSuperheatF + randFloat(-2, 2);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randInt(25, 35);
      const subcoolingF = config.designSubcoolingF + randFloat(3, 7);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      return { ...base, highPressureSwitchState: "tripped", condenserFanAmps: randFloat(1.8, 2.2) };
    },
    validationChecks: [{ measurement: "superheatF", designKey: "designSuperheatF", direction: "normal", maxAbsDelta: 3 }],
    reasoning: {
      primaryDiagnosis: "High-pressure switch tripping correctly due to a genuinely restricted (dirty) condenser coil -- the switch itself is working as designed",
      acceptableDiagnoses: ["high pressure trip caused by dirty condenser", "dirty condenser tripping the high-pressure switch", "condenser restriction causing the protection trip"],
      acceptablePartialDiagnoses: ["high side restriction causing a protection shutdown", "condenser airflow problem"],
      differentialDiagnosis: [
        { faultId: "elec-condenser-fan-motor-open", strength: "strong", whyItCouldFit: "Both involve high head pressure and a protection response", evidenceThatRulesItOut: "The fan is confirmed running with a normal amp draw here -- a dead fan would show zero amp draw" },
      ],
      minimumConclusion: "Identifies a dirty/restricted condenser coil as the underlying cause of the high-pressure trip, citing a running fan with normal amp draw together with elevated head pressure and subcooling -- the switch is doing its job correctly, not malfunctioning.",
    },
  },
  {
    id: "elec-lowpressure-protection-trip",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "advanced",
    complaints: ["System trips off on a low-pressure fault a few minutes into every cooling call; the return air filter looks heavily loaded with dust."],
    hints: [
      "A protection trip tells you the system shut itself down safely -- the real question is what pushed suction low enough to trip it.",
      "Subcooling is the reading that tells charge and airflow problems apart here, same as in a non-tripped scenario.",
    ],
    minimumRequiredEvidence: ["suctionSatTempF", "subcoolingF", "lowPressureSwitchState"],
    measurementRule: (config, cond) => {
      const severity = randInt(14, 22);
      const evapSatF = config.designEvapSatTempF - severity;
      const superheatF = config.designSuperheatF + severity * 0.9 + randFloat(-1, 1);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randFloat(-2, 2);
      const subcoolingF = config.designSubcoolingF + randFloat(-1.5, 1.5);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      return { ...base, lowPressureSwitchState: "tripped" };
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "high", minAbsDelta: 5 },
      { measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "normal", maxAbsDelta: 3 },
    ],
    reasoning: {
      primaryDiagnosis: "Low-pressure switch tripping correctly due to restricted airflow (dirty filter) starving the evaporator -- the switch itself is working as designed",
      acceptableDiagnoses: ["low pressure trip caused by restricted airflow", "dirty filter tripping the low-pressure switch", "airflow restriction causing the protection trip"],
      acceptablePartialDiagnoses: ["airflow restriction causing a protection shutdown", "evaporator side problem causing the trip"],
      differentialDiagnosis: [
        { faultId: "refrig-undercharge", strength: "strong", whyItCouldFit: "Also low suction with high superheat", evidenceThatRulesItOut: "Subcooling reads normal here rather than low, which is more consistent with an airflow cause than a charge shortage" },
      ],
      minimumConclusion: "Identifies restricted airflow (dirty filter) as the underlying cause of the low-pressure trip, citing normal subcooling alongside low suction and high superheat, with the loaded filter as supporting evidence.",
    },
  },
  {
    id: "elec-compressor-thermal-overload-trip",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "intermediate",
    complaints: ["AC runs for a while, shuts off on its own, then starts working again 20-30 minutes later without anyone touching it."],
    hints: [
      "This isn't a hard failure -- the system comes back on its own, which narrows things down quite a bit.",
      "Compare the amp draw just before shutdown against the compressor's rated current.",
    ],
    minimumRequiredEvidence: ["compressorAmpsBeforeShutdown", "nameplateRLA"],
    measurementRule: () => {
      const rla = randInt(13, 22);
      return { compressorAmpsBeforeShutdown: rla + randInt(3, 7), nameplateRLA: rla, voltageSupplyDuringOperation: "within normal range" };
    },
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Compressor internal thermal overload tripping under excess load, then auto-resetting once cooled",
      acceptableDiagnoses: ["compressor thermal overload tripping", "internal overload protecting the compressor", "compressor overheating and self-protecting"],
      acceptablePartialDiagnoses: ["compressor drawing excess current", "electrical protection event, cause not yet pinpointed"],
      differentialDiagnosis: [
        { faultId: "elec-compressor-winding-open", strength: "strong", whyItCouldFit: "Both are compressor electrical issues", evidenceThatRulesItOut: "This compressor runs for a while and draws current above nameplate before dropping out and later restarting on its own -- an open winding would never start or draw current at all" },
      ],
      minimumConclusion: "Identifies the compressor's internal thermal overload as the cause, citing amp draw climbing above nameplate RLA before a self-clearing shutdown and automatic restart after a cooldown.",
    },
  },
  {
    id: "elec-intermittent-contactor-fault",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "expert",
    complaints: ["AC works fine most of the time, but randomly drops out mid-cycle for a few minutes before coming back on its own -- happens a couple times a day, hard to catch in the act."],
    hints: [
      "An intermittent problem may test 'normal' most of the time -- the physical condition of a component can be a clue even when it's behaving at the moment you check it.",
      "Compare what the coil is doing against what the load side is doing during the same moment, ideally the moment it's actually acting up.",
    ],
    minimumRequiredEvidence: ["contactorContactCondition", "coilVoltageDuringACallSnapshot", "loadSideDuringADropoutSnapshot", "loadSideDuringNormalOperationSnapshot"],
    measurementRule: () => ({
      contactorContactCondition: "visible pitting/light arcing on inspection",
      coilVoltageDuringACallSnapshot: randFloat(23.8, 24.4),
      loadSideDuringADropoutSnapshot: "0 VAC (captured during one dropout)",
      loadSideDuringNormalOperationSnapshot: randFloat(228, 240),
    }),
    validationChecks: [],
    reasoning: {
      primaryDiagnosis: "Intermittently failing contactor (pitted/arcing contacts losing connection under vibration or thermal cycling)",
      acceptableDiagnoses: ["intermittent contactor fault", "pitted contactor losing contact intermittently", "contactor failing intermittently"],
      acceptablePartialDiagnoses: ["intermittent electrical connection problem", "contactor suspected but not confirmed on every check"],
      differentialDiagnosis: [
        { faultId: "elec-low-voltage-wiring-fault", strength: "moderate", whyItCouldFit: "Both can cause the system to stop responding", evidenceThatRulesItOut: "The coil stays properly energized on every snapshot including during a dropout -- an upstream wiring fault would typically also affect the coil signal, not just the load side" },
        { faultId: "elec-compressor-thermal-overload-trip", strength: "moderate", whyItCouldFit: "Both involve self-clearing dropouts", evidenceThatRulesItOut: "This system runs fine most of the time rather than following a load-based pattern, and the visible contact pitting is direct physical evidence pointing at the contactor" },
      ],
      minimumConclusion: "Identifies an intermittently failing contactor as the cause, citing visible contact pitting together with a captured snapshot showing the coil properly energized while the load side momentarily reads zero -- reasoning from a caught-in-the-act snapshot since the fault itself is intermittent.",
    },
  },

  /* ---------------- REFRIGERATION LOOK-ALIKES (batch 2) ---------------- */
  {
    id: "refrig-floodback-low-superheat",
    appliesTo: ["split_ac_r410a_txv_3ton", "minisplit_r410a_eev_1p5ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "advanced",
    complaints: ["System cools, maybe even too well, but the compressor sounds different than usual and the suction line is sweating heavily, almost dripping."],
    hints: [
      "This is the opposite pattern of a starved evaporator -- think about what happens when too much liquid gets through instead of too little.",
      "Subcooling staying close to normal here, rather than climbing, is what separates this from too much refrigerant in the system generally.",
    ],
    minimumRequiredEvidence: ["superheatF", "subcoolingF", "suctionSatTempF"],
    measurementRule: (config, cond) => {
      const severity = randInt(6, 12);
      const evapSatF = config.designEvapSatTempF + randFloat(-2, 2);
      const superheatF = config.designSuperheatF - severity * 0.9 + randFloat(-1, 1);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randFloat(-2, 2);
      const subcoolingF = config.designSubcoolingF + randFloat(-2, 2);
      return refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "low", minAbsDelta: 5 },
      { measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "normal", maxAbsDelta: 4 },
    ],
    reasoning: {
      primaryDiagnosis: "Metering device overfeeding the evaporator (stuck-open TXV/EEV), causing excessively low superheat and risking liquid floodback to the compressor",
      acceptableDiagnoses: ["overfeeding txv/eev", "metering device stuck open", "excessively low superheat, floodback risk", "txv/eev overfeeding the coil"],
      acceptablePartialDiagnoses: ["metering device problem", "floodback risk suspected"],
      differentialDiagnosis: [
        { faultId: "refrig-overcharge", strength: "strong", whyItCouldFit: "Both can involve excess liquid in the system", evidenceThatRulesItOut: "Subcooling reads close to normal here rather than elevated -- overcharge backs liquid up in the condenser and raises subcooling, while this is specifically a metering problem letting too much liquid through regardless of charge level" },
      ],
      minimumConclusion: "Identifies an overfeeding metering device as the cause, citing superheat well below target while subcooling stays close to normal -- distinguishing it from an overcharge, which would also elevate subcooling.",
    },
  },
  {
    id: "refrig-condenser-recirculation",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "expert",
    complaints: ["System is struggling to cool on a day that isn't even that hot -- the outdoor unit was recently boxed in by a new fence and some landscaping."],
    hints: [
      "Compare the temperature of the air actually arriving at the coil against the outdoor temperature everyone agrees on -- those aren't always the same thing.",
      "Recent changes to what's physically around the outdoor unit are worth asking about before assuming anything about the refrigerant circuit itself.",
    ],
    minimumRequiredEvidence: ["coilInletAirTempF", "reportedOutdoorAmbientF", "liquidSatTempF"],
    measurementRule: (config, cond) => {
      const recircBump = randInt(12, 22);
      const effectiveAmbientF = cond.outdoorTempF + recircBump;
      const evapSatF = config.designEvapSatTempF + randFloat(-2, 2);
      const superheatF = config.designSuperheatF + randFloat(-2, 2);
      const condSatF = effectiveAmbientF + config.designCondApproachF + randFloat(-2, 2);
      const subcoolingF = config.designSubcoolingF + randFloat(-1.5, 1.5);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      return { ...base, coilInletAirTempF: effectiveAmbientF, reportedOutdoorAmbientF: cond.outdoorTempF };
    },
    validationChecks: [],
    extraValidation: (config, cond, m) => ((m.coilInletAirTempF - cond.outdoorTempF) < 10 ? ["recirculation bump too small to be distinguishable from normal ambient variation"] : []),
    reasoning: {
      primaryDiagnosis: "Condenser discharge air recirculating back into its own intake (poor clearance/obstruction), raising the air temperature the coil actually sees well above true outdoor ambient",
      acceptableDiagnoses: ["condenser air recirculation", "poor clearance around outdoor unit causing recirculation", "discharge air recirculating into the intake"],
      acceptablePartialDiagnoses: ["something is elevating the effective ambient at the coil", "installation/clearance problem suspected"],
      differentialDiagnosis: [
        { faultId: "refrig-dirty-condenser", strength: "strong", whyItCouldFit: "Both show elevated head pressure", evidenceThatRulesItOut: "Nothing suggests the coil itself is dirty or blocked -- the air actually reaching the coil is simply much hotter than true outdoor temperature, which a clean coil can't compensate for" },
        { faultId: "refrig-overcharge", strength: "moderate", whyItCouldFit: "Both elevate head pressure", evidenceThatRulesItOut: "Subcooling stays close to normal here rather than elevated" },
      ],
      minimumConclusion: "Identifies condenser air recirculation as the cause, citing a coil-inlet air temperature well above the true reported outdoor ambient, with the coil and fan otherwise unremarkable -- an installation/clearance issue rather than a refrigerant or component fault.",
    },
  },
  {
    id: "refrig-liquid-line-restriction",
    appliesTo: ["split_ac_r410a_txv_3ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "advanced",
    complaints: ["System barely cools, and there's frost forming on a fitting partway along the liquid line outside, well before it reaches the indoor unit."],
    hints: [
      "The general suction-side pattern here could fit more than one restriction location -- the liquid line has more than one component that can restrict.",
      "A temperature drop across a specific component, measured on both sides of it, tells you exactly where along the line the restriction is.",
    ],
    minimumRequiredEvidence: ["linePreFilterDrierTempF", "linePostFilterDrierTempF", "suctionSatTempF", "superheatF"],
    measurementRule: (config, cond) => {
      const severity = randInt(10, 18);
      const evapSatF = config.designEvapSatTempF - severity;
      const superheatF = config.designSuperheatF + severity * 1.0 + randFloat(-1, 1);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randFloat(-2, 2);
      const subcoolingF = config.designSubcoolingF + randFloat(-1, 2);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      const preDrierTempF = base.liquidLineTempF + randFloat(8, 16);
      return { ...base, linePreFilterDrierTempF: Math.round(preDrierTempF * 10) / 10, linePostFilterDrierTempF: base.liquidLineTempF };
    },
    validationChecks: [],
    extraValidation: (config, cond, m) => ((m.linePreFilterDrierTempF - m.linePostFilterDrierTempF) < 6 ? ["temperature drop across the filter-drier too small to be distinguishable from a normal, unrestricted drier"] : []),
    reasoning: {
      primaryDiagnosis: "Restricted liquid-line filter-drier, starving the evaporator before the metering device even gets a chance to meter properly",
      acceptableDiagnoses: ["restricted filter-drier", "clogged liquid line filter-drier", "liquid line restriction at the drier"],
      acceptablePartialDiagnoses: ["liquid line restriction", "metering-adjacent restriction suspected"],
      differentialDiagnosis: [
        { faultId: "refrig-restricted-metering", strength: "strong", whyItCouldFit: "Produces a similar starved-evaporator refrigeration pattern", evidenceThatRulesItOut: "There's a clear temperature drop across the filter-drier itself, well before the metering device -- a restriction right at the metering device wouldn't show a temperature drop at a component further upstream" },
      ],
      minimumConclusion: "Identifies a restricted filter-drier as the cause, citing a significant temperature drop specifically across that component, upstream of the metering device -- not just the general starved-evaporator pattern, which alone wouldn't distinguish this from a metering-device restriction.",
    },
  },
  {
    id: "refrig-high-ambient-normal-operation",
    appliesTo: ["split_ac_r410a_txv_3ton", "minisplit_r410a_eev_1p5ton", "rtu_r410a_fixedorifice_5ton"],
    category: "refrigerant", difficulty: "advanced",
    complaints: ["Customer says the AC 'isn't keeping up' -- it's been an unusually brutal heat wave, well above the equipment's typical rating, for the past several days."],
    hints: [
      "Before assuming something is broken, check whether every reading actually looks abnormal, or just the customer's comfort level.",
      "Compare the head pressure against what the outdoor temperature alone would predict for a perfectly healthy system.",
    ],
    minimumRequiredEvidence: ["suctionSatTempF", "superheatF", "liquidSatTempF", "subcoolingF"],
    measurementRule: (config, cond) => {
      const evapSatF = config.designEvapSatTempF + randFloat(1, 4);
      const superheatF = config.designSuperheatF + randFloat(-2, 3);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randFloat(-2, 3);
      const subcoolingF = config.designSubcoolingF + randFloat(-2, 2);
      return refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
    },
    validationChecks: [
      { measurement: "superheatF", designKey: "designSuperheatF", direction: "normal", maxAbsDelta: 4 },
      { measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "normal", maxAbsDelta: 4 },
    ],
    extraValidation: (config, cond) => (cond.outdoorTempF < 100 ? ["outdoor ambient not extreme enough for a genuine normal-operation-under-load scenario"] : []),
    reasoning: {
      primaryDiagnosis: "No mechanical fault -- the system is operating within normal parameters for an outdoor ambient temperature well above typical design conditions",
      acceptableDiagnoses: ["no fault found, system operating normally for the conditions", "working as designed given the extreme heat", "not actually malfunctioning -- expected performance under high ambient load"],
      acceptablePartialDiagnoses: ["performance drop explained by ambient conditions, not a component failure", "system checks out electrically and mechanically"],
      differentialDiagnosis: [
        { faultId: "refrig-dirty-condenser", strength: "moderate", whyItCouldFit: "Both can involve elevated head pressure", evidenceThatRulesItOut: "Head pressure here is proportionate to the extreme outdoor temperature and design approach -- not elevated beyond what that ambient alone would explain" },
        { faultId: "refrig-undercharge", strength: "moderate", whyItCouldFit: "Both can involve a 'not cooling enough' complaint", evidenceThatRulesItOut: "Superheat and subcooling both read within normal range here" },
      ],
      minimumConclusion: "Concludes there is no mechanical fault, citing superheat and subcooling both within normal range and head pressure proportionate to the extreme outdoor ambient -- reduced comfort is explained by operating conditions exceeding the equipment's design envelope, not a failure.",
    },
  },

  /* ---------------- MINI-SPLIT SPECIFIC (batch 2) ---------------- */
  {
    id: "minisplit-outdoor-sensor-fault",
    appliesTo: ["minisplit_r410a_eev_1p5ton"],
    category: "electrical", difficulty: "intermediate",
    complaints: ["Mini-split short-cycles oddly and seems to ramp the compressor up and down erratically, even though conditions in the room haven't changed."],
    hints: [
      "The board is making decisions based on a sensor reading -- confirm that reading is actually true before assuming a mechanical or refrigerant problem.",
      "A big, persistent gap between a sensor's reported value and a directly measured value points at the sensor itself.",
    ],
    minimumRequiredEvidence: ["outdoorCoilSensorReportedTempF", "actualOutdoorCoilTempMeasuredF"],
    measurementRule: () => ({
      outdoorCoilSensorReportedTempF: randInt(20, 35),
      actualOutdoorCoilTempMeasuredF: randInt(75, 95),
      boardBehavior: "modulating compressor speed as if the coil were much colder than it is",
    }),
    validationChecks: [],
    extraValidation: (config, cond, m) => ((m.actualOutdoorCoilTempMeasuredF - m.outdoorCoilSensorReportedTempF) < 30 ? ["sensor discrepancy too small to be distinguishable from normal sensor tolerance"] : []),
    reasoning: {
      primaryDiagnosis: "Outdoor coil temperature sensor reading incorrectly, causing the board to modulate the compressor based on false information",
      acceptableDiagnoses: ["faulty outdoor coil sensor", "outdoor temperature sensor reading wrong", "bad sensor causing erratic compressor behavior"],
      acceptablePartialDiagnoses: ["sensor problem suspected", "control board reacting to bad input"],
      differentialDiagnosis: [
        { faultId: "minisplit-eev-fault", strength: "moderate", whyItCouldFit: "Both are inverter control-related faults", evidenceThatRulesItOut: "The EEV's commanded and actual position aren't in question here -- the erratic behavior traces to what the board believes the coil temperature is, not to the metering device" },
      ],
      minimumConclusion: "Identifies the outdoor coil sensor as the cause, citing a large, sustained gap between what the sensor reports and what the coil is actually measured at directly, with the erratic behavior consistent with reacting to that false reading.",
    },
  },
  {
    id: "minisplit-protection-highpressure-code",
    appliesTo: ["minisplit_r410a_eev_1p5ton"],
    category: "electrical", difficulty: "intermediate",
    complaints: ["Mini-split displays a high-pressure protection code and shuts down a few minutes into every cooling call; the outdoor unit is visibly buried in fallen leaves and debris."],
    hints: [
      "A protection code names what tripped, not necessarily why -- look at whether the underlying reading that would cause that trip is actually present.",
      "Visible physical obstruction at the coil is worth checking before assuming anything electronic.",
    ],
    minimumRequiredEvidence: ["protectionCodeDisplayed", "liquidSatTempF", "subcoolingF"],
    measurementRule: (config, cond) => {
      const evapSatF = config.designEvapSatTempF + randFloat(-2, 2);
      const superheatF = config.designSuperheatF + randFloat(-2, 2);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randInt(25, 35);
      const subcoolingF = config.designSubcoolingF + randFloat(3, 7);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      return { ...base, protectionCodeDisplayed: "high pressure protection" };
    },
    validationChecks: [{ measurement: "subcoolingF", designKey: "designSubcoolingF", direction: "high", minAbsDelta: 5 }],
    reasoning: {
      primaryDiagnosis: "High-pressure protection code triggered correctly by a genuinely blocked/iced outdoor coil -- not a control board malfunction",
      acceptableDiagnoses: ["high pressure code caused by blocked outdoor coil", "outdoor coil blocked with debris tripping protection", "restricted outdoor coil causing the protection code"],
      acceptablePartialDiagnoses: ["condenser airflow problem causing the protection trip", "outdoor unit airflow restriction"],
      differentialDiagnosis: [
        { faultId: "minisplit-communication-fault", strength: "strong", whyItCouldFit: "Both are protection/error-code scenarios", evidenceThatRulesItOut: "This unit displays a specific, different code tied to elevated head pressure, and the measurements confirm a real high-side restriction -- not a communication issue with no clear refrigeration-side cause" },
      ],
      minimumConclusion: "Identifies a blocked/restricted outdoor coil as the cause behind the protection code, citing elevated head pressure and subcooling together with the visibly obstructed coil -- the error code is evidence of a real condition, not a board malfunction to chase on its own.",
    },
  },

  /* ---------------- RTU SPECIFIC (batch 2) ---------------- */
  {
    id: "rtu-mixed-air-sensor-fault",
    appliesTo: ["rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "expert",
    complaints: ["Space runs cold and clammy on a mild day, similar to what an economizer stuck open would cause -- but this time the damper doesn't look unusually open."],
    hints: [
      "This can look identical to an economizer-damper problem at first -- check whether the damper's actual position is unusual before assuming it is.",
      "Compare what the mixed-air sensor reports against a reasonable estimate based on the outdoor and return temperatures -- a mismatch there points somewhere very specific.",
    ],
    minimumRequiredEvidence: ["economizerDamperPositionPct", "sensorReportedMixedAirTempF", "trueMixedAirTempFEstimate"],
    measurementRule: (config, cond) => {
      const severity = randInt(8, 15);
      const evapSatF = config.designEvapSatTempF - severity;
      const superheatF = config.designSuperheatF + severity * 0.7 + randFloat(-1, 1);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + randFloat(-2, 2);
      const subcoolingF = config.designSubcoolingF + randFloat(-1.5, 1.5);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      const damperPct = randInt(30, 45);
      const sensorReportedMixedAirTempF = randInt(45, 52);
      const trueMixedAirTempFEstimate = Math.round(cond.outdoorTempF * (damperPct / 100) + cond.returnAirTempF * (1 - damperPct / 100));
      return { ...base, economizerDamperPositionPct: damperPct, sensorReportedMixedAirTempF, trueMixedAirTempFEstimate };
    },
    validationChecks: [{ measurement: "superheatF", designKey: "designSuperheatF", direction: "high", minAbsDelta: 4 }],
    extraValidation: (config, cond, m) => {
      const notes = [];
      if (Math.abs(m.sensorReportedMixedAirTempF - m.trueMixedAirTempFEstimate) < 8) notes.push("sensor vs true mixed-air gap too small to be distinguishable");
      if (m.economizerDamperPositionPct > 55) notes.push("damper position too open -- would look like the economizer-damper fault instead of a sensor-only fault");
      return notes;
    },
    reasoning: {
      primaryDiagnosis: "Mixed-air temperature sensor reading incorrectly, causing the economizer control logic to behave as though outdoor air were more useful than it actually is -- the damper itself is mechanically responding correctly to bad information",
      acceptableDiagnoses: ["mixed air sensor fault", "bad mixed-air temperature sensor", "economizer control sensor reading wrong"],
      acceptablePartialDiagnoses: ["economizer control problem, sensor suspected", "control logic reacting to bad input"],
      differentialDiagnosis: [
        { faultId: "rtu-economizer-fault", strength: "strong", whyItCouldFit: "Both produce a starved-evaporator refrigeration pattern via the economizer system", evidenceThatRulesItOut: "The damper position here is moderate, not unusually wide open the way a stuck-open damper fault would show -- the mismatch is between the sensor's reading and a reasonable estimate of true mixed-air temperature, not the damper's mechanical position" },
      ],
      minimumConclusion: "Identifies the mixed-air temperature sensor as the cause, citing a damper position that isn't itself abnormal alongside a sensor reading that disagrees substantially with what the outdoor/return blend should produce -- distinguishing a sensor problem from a damper/actuator problem.",
    },
  },
  {
    id: "rtu-staged-condenser-fan-control-fault",
    appliesTo: ["rtu_r410a_fixedorifice_5ton"],
    category: "electrical", difficulty: "advanced",
    complaints: ["Packaged unit's head pressure runs high under load, and only one of its two condenser fans seems to be running."],
    hints: [
      "Two-fan RTUs stage their condenser fans based on load or pressure -- confirm whether the control signal for the second fan is even being sent.",
      "A fan that isn't running despite a valid call to run it is a different problem than a fan that's running into a dirty coil.",
    ],
    minimumRequiredEvidence: ["fanStage1Amps", "fanStage2Amps", "fanStage2CallSignalPresent", "liquidSatTempF"],
    measurementRule: (config, cond) => {
      const severity = randInt(15, 28);
      const evapSatF = config.designEvapSatTempF + randFloat(-2, 2);
      const superheatF = config.designSuperheatF + randFloat(-2, 2);
      const condSatF = cond.outdoorTempF + config.designCondApproachF + severity;
      const subcoolingF = config.designSubcoolingF + severity * 0.15 + randFloat(-1, 1);
      const base = refrigMeasurements({ config, cond, evapSatF, superheatF, condSatF, subcoolingF });
      return { ...base, fanStage1Amps: randFloat(1.8, 2.2), fanStage2Amps: 0, fanStage2CallSignalPresent: true };
    },
    validationChecks: [{ measurement: "superheatF", designKey: "designSuperheatF", direction: "normal", maxAbsDelta: 3 }],
    reasoning: {
      primaryDiagnosis: "Second-stage condenser fan not responding to a valid stage-2 call (fan control board or fan motor/contactor fault on that stage specifically)",
      acceptableDiagnoses: ["stage-2 condenser fan not running despite a valid call", "condenser fan staging fault", "second fan not responding to its control signal"],
      acceptablePartialDiagnoses: ["condenser fan control problem", "only one of two fans running under high load"],
      differentialDiagnosis: [
        { faultId: "refrig-dirty-condenser", strength: "strong", whyItCouldFit: "Both show elevated head pressure from reduced condenser airflow", evidenceThatRulesItOut: "Fan stage 1 runs with normal amp draw and the call signal for stage 2 is confirmed present at the board -- a dirty coil wouldn't involve a fan failing to respond to its own control signal" },
      ],
      minimumConclusion: "Identifies a second-stage condenser fan control/motor fault as the cause, citing a confirmed stage-2 call signal present at the board while that fan draws zero current, alongside the resulting elevated head pressure -- distinguishing a staging/control fault from a simple dirty coil.",
    },
  },
];
const FAULT_MAP = Object.fromEntries(FAULTS.map((f) => [f.id, f]));

/* =========================================================================
   5. RULE-BASED VALIDATOR (no AI here -- deterministic checks only)
   Layers: (a) per-fault relative-to-design separation checks, (b) universal
   absolute plausibility bounds for cooling faults, (c) an optional
   fault.extraValidation() hook for checks that need more context than a
   flat config field (e.g. comparisons involving cond.outdoorTempF), and
   (d) presence checks for each fault's declared minimumRequiredEvidence.
   ========================================================================= */
function validateScenario(fault, config, cond, measurements) {
  const notes = [];
  for (const check of fault.validationChecks || []) {
    const val = measurements[check.measurement];
    const design = config[check.designKey];
    if (val === undefined || design === undefined) continue;
    const delta = val - design;
    if (check.direction === "high" && delta < check.minAbsDelta) notes.push(`${check.measurement} delta (+${delta.toFixed(1)}) below minimum separation (${check.minAbsDelta}) for a 'high' signature`);
    if (check.direction === "low" && -delta < check.minAbsDelta) notes.push(`${check.measurement} delta (${delta.toFixed(1)}) below minimum separation (${check.minAbsDelta}) for a 'low' signature`);
    if (check.direction === "normal" && Math.abs(delta) > check.maxAbsDelta) notes.push(`${check.measurement} delta (${delta.toFixed(1)}) exceeds max deviation (${check.maxAbsDelta}) for a 'stays normal' signature`);
  }
  if (config.system === "cooling") {
    if (measurements.suctionPsig <= 0) notes.push("suctionPsig non-physical (<=0)");
    if (measurements.superheatF < 0) notes.push("negative superheat (flooding) not modeled by this fault set");
    if (measurements.subcoolingF < 0) notes.push("negative subcooling non-physical");
    if (measurements.suctionSatTempF < PHYS_BOUNDS.suctionSatMin || measurements.suctionSatTempF > PHYS_BOUNDS.suctionSatMax) notes.push("suctionSatTempF outside realistic AC-mode envelope");
    if (measurements.superheatF > PHYS_BOUNDS.superheatMax) notes.push("superheat implausibly high");
    if (measurements.subcoolingF > PHYS_BOUNDS.subcoolMax) notes.push("subcooling implausibly high");
  }
  if (fault.extraValidation) {
    const extraNotes = fault.extraValidation(config, cond, measurements) || [];
    notes.push(...extraNotes);
  }
  for (const key of fault.minimumRequiredEvidence || []) {
    if (measurements[key] === undefined) notes.push(`minimumRequiredEvidence "${key}" missing from generated measurements`);
  }
  if (!fault.appliesTo.includes(config.id)) notes.push("fault does not apply to this configuration");
  return { passed: notes.length === 0, notes };
}

/* =========================================================================
   6. SCENARIO GENERATOR (with retry/reject loop + recent-fault diversity)
   Returns ONE authoritative scenario object. The UI and the debug panel
   both render from this same object. recentFaultIds (passed in from the
   caller's session state) is used to avoid repeating the same underlying
   fault back-to-back -- falls back to the full eligible pool only if the
   filters are narrow enough that nothing fresh is available.
   ========================================================================= */
function buildReasoningPayload(fault) {
  const differentials = (fault.reasoning.differentialDiagnosis || []).map((d) => ({
    faultId: d.faultId,
    label: FAULT_MAP[d.faultId] ? FAULT_MAP[d.faultId].reasoning.primaryDiagnosis : d.faultId,
    strength: d.strength || "moderate",
    whyItCouldFit: d.whyItCouldFit,
    evidenceThatRulesItOut: d.evidenceThatRulesItOut,
  }));
  return {
    primaryDiagnosis: fault.reasoning.primaryDiagnosis,
    acceptableDiagnoses: fault.reasoning.acceptableDiagnoses,
    acceptablePartialDiagnoses: fault.reasoning.acceptablePartialDiagnoses,
    plausibleUnprovenCause: fault.reasoning.plausibleUnprovenCause || null,
    differentialDiagnosis: differentials,
    minimumConclusion: fault.reasoning.minimumConclusion,
  };
}

function generateScenario(filters, recentFaultIds = []) {
  const eligibleConfigs = Object.values(CONFIGS).filter(
    (c) => !filters.equipmentFamily || filters.equipmentFamily === "any" || c.equipmentFamily === filters.equipmentFamily
  );
  const eligibleFaults = FAULTS.filter(
    (f) =>
      (!filters.difficulty || filters.difficulty === "any" || f.difficulty === filters.difficulty) &&
      (!filters.topic || filters.topic === "any" || f.category === filters.topic) &&
      f.appliesTo.some((cid) => eligibleConfigs.some((c) => c.id === cid))
  );
  if (eligibleFaults.length === 0) return { error: "No faults match the selected filters." };

  const freshFaults = eligibleFaults.filter((f) => !recentFaultIds.includes(f.id));
  const faultPool = freshFaults.length > 0 ? freshFaults : eligibleFaults;

  const rejectedAttempts = [];
  const MAX_ATTEMPTS = 8;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const fault = pick(faultPool);
    const configId = pick(fault.appliesTo.filter((cid) => eligibleConfigs.some((c) => c.id === cid)));
    const config = CONFIGS[configId];
    const cond = generateOperatingConditions(config);
    const measurements = fault.measurementRule(config, cond);
    const validation = validateScenario(fault, config, cond, measurements);
    if (validation.passed) {
      const reasoningPayload = buildReasoningPayload(fault);
      return {
        id: `scn-${fault.id}-${Date.now()}`,
        fault, config, cond, measurements,
        complaint: pick(fault.complaints),
        hints: fault.hints || [],
        sequence: SEQUENCES[config.id] || null,
        sequenceImpact: fault.sequenceImpact || null,
        reasoning: reasoningPayload,
        tags: { equipment: config.equipmentFamily, configuration: config.id, system: config.system, topic: fault.category, fault_category: fault.id, difficulty: fault.difficulty },
        debug: { rejectedAttempts, chosenOnAttempt: i + 1, totalAttempts: i + 1, faultPoolExcludedRecent: freshFaults.length > 0 },
      };
    }
    rejectedAttempts.push({ attempt: i + 1, faultId: fault.id, configId, cond, measurements, validationNotes: validation.notes });
  }
  return { error: "Could not generate a valid scenario after max attempts.", debug: { rejectedAttempts } };
}

/* =========================================================================
   7. EVALUATOR -- isolated behind one function/interface.
   Uses the artifact environment's built-in Claude access (no API key, no
   Settings panel). To move this to external hosting later, replace only
   the body of this function with a call to your own server-side proxy --
   nothing else in the app needs to change.
   ========================================================================= */
async function evaluateDiagnosis({ scenario, userAnswer }) {
  const payload = {
    scenario: {
      equipment: equipmentLabel(scenario.config),
      refrigerant: scenario.config.refrigerantId || null,
      operatingConditions: scenario.cond,
      complaint: scenario.complaint,
      measurements: scenario.measurements,
    },
    diagnosticModel: scenario.reasoning,
    userAnswer,
  };
  const systemPrompt = `You are an evaluator for an HVAC diagnostic training tool. Evaluate the user's diagnosis ONLY against the supplied scenario data and diagnostic model below. Do not introduce new HVAC facts, measurements, faults, or assumptions not present in the payload. Do not change the intended diagnosis.

The diagnostic model separates what the evidence actually PROVES (diagnosticModel.primaryDiagnosis / acceptableDiagnoses / acceptablePartialDiagnoses) from any more specific root cause that might be plausible but isn't established by this scenario (diagnosticModel.plausibleUnprovenCause, when present). Grade against the provable core diagnosis, not unproven specifics:
- If the user's answer matches or reasonably paraphrases primaryDiagnosis or an acceptableDiagnoses entry, and their stated reasoning is consistent with scenario.measurements/scenario.complaint: verdict "correct" -- even if they also add a plausible-but-unproven specific cause (like the one in plausibleUnprovenCause). Note that addition in evidenceCited/missingEvidence rather than penalizing it.
- If the user identifies the correct general category (an acceptablePartialDiagnoses entry) or gets the core fault right but misses key supporting evidence: verdict "partial".
- If the user names a different fault, or their reasoning contradicts the evidence: verdict "incorrect".
- Never require the user to have guessed information that isn't present in scenario.measurements or scenario.complaint.
- diagnosticModel.differentialDiagnosis entries include a "strength" field ("strong"/"moderate"/"weak") describing how decisively the evidence favors ruling out that alternative. Weigh a user's elimination reasoning accordingly -- don't require them to rule out a "weak" alternative as firmly as a "strong" one.

Respond with ONLY a JSON object, no markdown fences, no preamble:
{"verdict":"correct"|"partial"|"incorrect","matched":"<which acceptable/partial phrase it matches, or null>","evidenceCited":["..."],"missingEvidence":["..."],"explanation":"<2-4 sentences, referencing scenario.reasoning.minimumConclusion>"}

Scenario + diagnostic model + user answer:
${JSON.stringify(payload)}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: systemPrompt }],
      }),
    });
    const data = await response.json();
    const text = (data.content || []).map((c) => c.text || "").join("\n");
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (err) {
    return { verdict: "error", explanation: "Evaluator call failed: " + String(err) };
  }
}

/* =========================================================================
   8. PROGRESS -- artifact persistent storage (personal, not shared).
   ========================================================================= */
const PROGRESS_KEY = "hvac_trainer_progress_v1";
const DEFAULT_PROGRESS = { solved: 0, correct: 0, currentDifficulty: "beginner", streak: 0, byEquipment: {}, byTopic: {}, history: [] };
const DIFF_ORDER = ["beginner", "intermediate", "advanced", "expert"];

async function loadProgress() {
  try {
    const result = await window.storage.get(PROGRESS_KEY, false);
    if (result && result.value) return JSON.parse(result.value);
  } catch (e) {
    // key doesn't exist yet -- first run
  }
  return DEFAULT_PROGRESS;
}
async function saveProgress(p) {
  try {
    await window.storage.set(PROGRESS_KEY, JSON.stringify(p), false);
  } catch (e) {
    console.error("Progress save failed", e);
  }
}
function nextProgress(progress, scenario, verdict) {
  const p = { ...progress, byEquipment: { ...progress.byEquipment }, byTopic: { ...progress.byTopic } };
  p.solved += 1;
  if (verdict === "correct") p.correct += 1;
  const eq = scenario.config.equipmentFamily;
  const topic = scenario.fault.category;
  p.byEquipment[eq] = (p.byEquipment[eq] || 0) + 1;
  p.byTopic[topic] = (p.byTopic[topic] || 0) + 1;
  p.history = [...p.history.slice(-49), { faultId: scenario.fault.id, verdict, ts: Date.now() }];
  if (verdict === "correct") {
    p.streak += 1;
    if (p.streak >= 3) {
      const idx = DIFF_ORDER.indexOf(p.currentDifficulty);
      if (idx < DIFF_ORDER.length - 1) { p.currentDifficulty = DIFF_ORDER[idx + 1]; p.streak = 0; }
    }
  } else {
    p.streak = 0;
  }
  return p;
}

/* =========================================================================
   9. UI
   ========================================================================= */
const COLORS = {
  bgDeep: "#141a22", bgPanel: "#1c2531", bgPanel2: "#232e3c",
  paper: "#ece7d8", paperDark: "#ddd6c1", ink: "#252119", label: "#453e2e",
  low: "#4f93c9", lowDeep: "#2f6d9e", high: "#c15a3e", highDeep: "#9c4530",
  amber: "#d99a3d", green: "#5c8f5f", red: "#b8483a", line: "#3a4656",
};
const DIFF_COLOR = { beginner: COLORS.green, intermediate: COLORS.amber, advanced: COLORS.red, expert: "#8a3a2c" };

function Gauge({ value, max, color, colorDeep, label, unit }) {
  const angle = Math.min(180, Math.max(0, (value / max) * 180));
  const rad = ((180 - angle) * Math.PI) / 180;
  const cx = 100, cy = 100, r = 74;
  const nx = cx + r * Math.cos(rad), ny = cy - r * Math.sin(rad);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 140 }}>
      <svg viewBox="0 0 200 118" width="100%" height="auto">
        <path d="M 26 100 A 74 74 0 0 1 174 100" fill="none" stroke={colorDeep} strokeWidth="14" strokeLinecap="round" opacity="0.25" />
        <path d={`M 26 100 A 74 74 0 0 1 ${nx} ${ny}`} fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={COLORS.ink} strokeWidth="3" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="6" fill={COLORS.ink} />
      </svg>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 600, color: COLORS.ink, marginTop: -6 }}>
        {value}<span style={{ fontSize: 10.5, color: COLORS.label }}> {unit}</span>
      </div>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11.5, letterSpacing: ".1em", textTransform: "uppercase", color: COLORS.label }}>{label}</div>
    </div>
  );
}

function LCDRow({ label, value, unit, ok }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "#1a2029", borderRadius: 6, padding: "9px 12px", marginBottom: 7, border: `1px solid ${ok === false ? "#8a3a2c" : ok === true ? "#3d6b40" : "#333c48"}` }}>
      <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, color: "#c9d3df" }}>{label}</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5, fontWeight: 600, color: ok === false ? "#ef8a76" : ok === true ? "#8fd19e" : "#e8e2d4" }}>{value}{unit ? ` ${unit}` : ""}</span>
    </div>
  );
}

function sectionLabelStyle() {
  return { fontFamily: "'Barlow Condensed', sans-serif", fontSize: 11.5, letterSpacing: ".1em", textTransform: "uppercase", color: COLORS.label, marginBottom: 6, fontWeight: 600 };
}

function stageOrder(sequence, id) { const s = sequence.find((x) => x.id === id); return s ? s.order : 999; }

const STANDARD_REFRIG_KEYS = ["suctionPsig", "liquidPsig", "suctionSatTempF", "liquidSatTempF", "superheatF", "subcoolingF", "suctionLineTempF", "liquidLineTempF"];

function ScenarioMeasurements({ scenario }) {
  const m = scenario.measurements;
  if (scenario.config.system === "cooling") {
    const extraEntries = Object.entries(m).filter(([k]) => !STANDARD_REFRIG_KEYS.includes(k));
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: COLORS.label, fontWeight: 700, marginBottom: 12 }}>
          REFRIGERANT: {scenario.config.refrigerantId}
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 20, marginBottom: 14, flexWrap: "wrap" }}>
          <Gauge value={m.suctionPsig} max={220} color={COLORS.low} colorDeep={COLORS.lowDeep} label="Suction PSIG" unit="" />
          <Gauge value={m.liquidPsig} max={450} color={COLORS.high} colorDeep={COLORS.highDeep} label="Liquid/Head PSIG" unit="" />
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: extraEntries.length ? 10 : 0 }}>
          <div style={{ flex: 1, minWidth: 170 }}>
            <div style={sectionLabelStyle()}>Suction Side</div>
            <LCDRow label="Suction line temp" value={m.suctionLineTempF} unit="°F" />
            <LCDRow label="Superheat" value={m.superheatF} unit="°F" />
          </div>
          <div style={{ flex: 1, minWidth: 170 }}>
            <div style={sectionLabelStyle()}>Liquid / Head Side</div>
            <LCDRow label="Liquid line temp" value={m.liquidLineTempF} unit="°F" />
            <LCDRow label="Subcooling" value={m.subcoolingF} unit="°F" />
          </div>
        </div>
        {extraEntries.length > 0 && (
          <div>
            {extraEntries.map(([k, v], i) => <LCDRow key={i} label={k} value={typeof v === "boolean" ? (v ? "yes" : "no") : v} />)}
          </div>
        )}
      </div>
    );
  }
  const rows = Object.entries(m).map(([k, v]) => ({ label: k, value: typeof v === "boolean" ? (v ? "yes" : "no") : v }));
  return <div style={{ marginBottom: 16 }}>{rows.map((r, i) => <LCDRow key={i} label={r.label} value={r.value} />)}</div>;
}

function SequenceBar({ scenario }) {
  if (!scenario.sequence) return null;
  const impact = scenario.sequenceImpact;
  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 14, flexWrap: "wrap" }}>
      {scenario.sequence.map((stage) => {
        let state = "ok";
        if (impact && impact.blocksAtStage) {
          state = stageOrder(scenario.sequence, stage.id) < stageOrder(scenario.sequence, impact.blocksAtStage) ? "ok" : (stage.id === impact.blocksAtStage ? "fail" : "unreached");
        } else if (impact && impact.degradesAtStage) {
          state = stageOrder(scenario.sequence, stage.id) < stageOrder(scenario.sequence, impact.degradesAtStage) ? "ok" : (stage.id === impact.degradesAtStage ? "degrade" : "unreached");
        }
        const bg = state === "ok" ? COLORS.green : state === "fail" ? COLORS.red : state === "degrade" ? COLORS.amber : "#4a5563";
        return (
          <span key={stage.id} title={stage.name} style={{ background: bg, color: "#fff", fontSize: 11, padding: "4px 10px", borderRadius: 999, fontFamily: "'IBM Plex Mono', monospace" }}>
            {stage.name}
          </span>
        );
      })}
    </div>
  );
}

function HintsPanel({ hints }) {
  const [revealed, setRevealed] = useState({});
  if (!hints || hints.length === 0) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={sectionLabelStyle()}>Hints (optional)</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {hints.map((h, i) => (
          <div key={i}>
            {revealed[i] ? (
              <div style={{ fontSize: 13.5, lineHeight: 1.5, color: COLORS.ink, background: "#f3efe2", border: `1px solid ${COLORS.paperDark}`, borderRadius: 7, padding: "9px 12px" }}>{h}</div>
            ) : (
              <button
                onClick={() => setRevealed((r) => ({ ...r, [i]: true }))}
                style={{ background: "none", border: `1px dashed ${COLORS.label}`, color: COLORS.label, borderRadius: 7, padding: "8px 12px", fontSize: 13, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}
              >
                Reveal hint {i + 1}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DebugPanel({ scenario }) {
  const [open, setOpen] = useState(false);
  if (!scenario) return null;
  return (
    <div style={{ maxWidth: 720, margin: "14px auto 0" }}>
      <button onClick={() => setOpen((o) => !o)} style={{ background: "none", border: `1px solid ${COLORS.line}`, color: "#9fb0c4", borderRadius: 7, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>
        {open ? "Hide" : "Show"} developer debug info
      </button>
      {open && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#9fb0c4", marginBottom: 4 }}>
            CHOSEN SCENARIO (authoritative -- identical to what's rendered above; includes operatingConditions.lineLength, which is intentionally not shown on the player-facing page)
          </div>
          <pre style={{ fontFamily: "'IBM Plex Mono', monospace", background: "#0e131a", color: "#c9d3df", padding: 14, borderRadius: 8, fontSize: 11.5, overflowX: "auto", maxHeight: 340 }}>
            {JSON.stringify(
              {
                configId: scenario.config.id,
                equipmentLabel: equipmentLabel(scenario.config),
                meteringDevice: scenario.config.meteringDevice,
                refrigerantId: scenario.config.refrigerantId,
                faultId: scenario.fault.id,
                operatingConditions: scenario.cond,
                measurements: scenario.measurements,
                tags: scenario.tags,
                reasoning: scenario.reasoning,
                hints: scenario.hints,
              },
              null,
              2
            )}
          </pre>
          {scenario.debug.rejectedAttempts && scenario.debug.rejectedAttempts.length > 0 && (
            <>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: "#9fb0c4", margin: "10px 0 4px" }}>
                REJECTED ATTEMPTS during generation (not shown to the user)
              </div>
              <pre style={{ fontFamily: "'IBM Plex Mono', monospace", background: "#0e131a", color: "#8a95a6", padding: 14, borderRadius: 8, fontSize: 11, overflowX: "auto", maxHeight: 260 }}>
                {JSON.stringify(scenario.debug.rejectedAttempts, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [filters, setFilters] = useState({ equipmentFamily: "any", difficulty: "any", topic: "any" });
  const [scenario, setScenario] = useState(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState(null);
  const [evaluating, setEvaluating] = useState(false);
  const [progress, setProgress] = useState(DEFAULT_PROGRESS);
  const [progressLoaded, setProgressLoaded] = useState(false);
  const [genError, setGenError] = useState(null);
  const [recentFaultIds, setRecentFaultIds] = useState([]);

  useEffect(() => {
    let mounted = true;
    loadProgress().then((p) => { if (mounted) { setProgress(p); setProgressLoaded(true); } });
    return () => { mounted = false; };
  }, []);

  const newScenario = useCallback(() => {
    const s = generateScenario(filters, recentFaultIds);
    if (s.error) { setGenError(s.error); setScenario(null); }
    else {
      setGenError(null);
      setScenario(s);
      setRecentFaultIds((ids) => [...ids.slice(-5), s.fault.id]);
    }
    setAnswer(""); setResult(null);
  }, [filters, recentFaultIds]);

  useEffect(() => { newScenario(); }, []); // eslint-disable-line

  async function submit() {
    if (!answer.trim() || !scenario) return;
    setEvaluating(true);
    const r = await evaluateDiagnosis({ scenario, userAnswer: answer });
    setEvaluating(false);
    setResult(r);
    if (r.verdict === "correct" || r.verdict === "partial" || r.verdict === "incorrect") {
      const updated = nextProgress(progress, scenario, r.verdict);
      setProgress(updated);
      saveProgress(updated);
    }
  }

  const accuracy = progress.solved ? Math.round((100 * progress.correct) / progress.solved) : 0;

  return (
    <div style={{ minHeight: "100%", background: `radial-gradient(circle at 15% 0%, ${COLORS.bgPanel} 0%, ${COLORS.bgDeep} 55%)`, fontFamily: "Inter, system-ui, sans-serif", padding: "28px 16px 48px", color: COLORS.paper }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Mono:wght@500;600&family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; }
        textarea:focus, select:focus { outline: 2px solid ${COLORS.amber}; }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto 18px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 13, letterSpacing: ".22em", color: COLORS.low, textTransform: "uppercase" }}>HVAC Diagnostic Reasoning Engine</div>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 32, fontWeight: 700 }}>Diagnose the Call</div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, textAlign: "right" }}>
            <div style={{ color: "#8a95a6" }}>SOLVED / ACCURACY</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{progress.solved} / {accuracy}%{!progressLoaded && " (loading…)"}</div>
          </div>
          <span style={{ background: DIFF_COLOR[progress.currentDifficulty], color: "#fff", padding: "4px 10px", borderRadius: 999, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>{progress.currentDifficulty}</span>
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto 14px", display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={filters.equipmentFamily} onChange={(e) => setFilters((f) => ({ ...f, equipmentFamily: e.target.value }))} style={{ fontFamily: "'IBM Plex Mono', monospace", background: "#1a2029", color: COLORS.paper, border: `1px solid ${COLORS.line}`, borderRadius: 6, padding: "7px 9px", fontSize: 13 }}>
          <option value="any">Any equipment</option>
          <option value="split_ac">Split AC</option>
          <option value="mini_split">Mini-split</option>
          <option value="packaged_unit">RTU / Packaged</option>
          <option value="furnace">Furnace</option>
        </select>
        <select value={filters.difficulty} onChange={(e) => setFilters((f) => ({ ...f, difficulty: e.target.value }))} style={{ fontFamily: "'IBM Plex Mono', monospace", background: "#1a2029", color: COLORS.paper, border: `1px solid ${COLORS.line}`, borderRadius: 6, padding: "7px 9px", fontSize: 13 }}>
          <option value="any">Any difficulty</option>
          <option value="beginner">Beginner</option>
          <option value="intermediate">Intermediate</option>
          <option value="advanced">Advanced</option>
          <option value="expert">Expert</option>
        </select>
        <select value={filters.topic} onChange={(e) => setFilters((f) => ({ ...f, topic: e.target.value }))} style={{ fontFamily: "'IBM Plex Mono', monospace", background: "#1a2029", color: COLORS.paper, border: `1px solid ${COLORS.line}`, borderRadius: 6, padding: "7px 9px", fontSize: 13 }}>
          <option value="any">Any topic</option>
          <option value="refrigerant">Refrigerant circuit</option>
          <option value="electrical">Electrical</option>
          <option value="combustion">Combustion</option>
          <option value="airflow">Airflow</option>
        </select>
        <button onClick={newScenario} style={{ background: "none", border: `1px solid ${COLORS.line}`, color: "#9fb0c4", borderRadius: 7, padding: "8px 14px", fontSize: 13, cursor: "pointer" }}>↻ New scenario</button>
      </div>

      {genError && <div style={{ maxWidth: 720, margin: "0 auto", color: COLORS.red }}>{genError}</div>}

      {scenario && (
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ background: COLORS.paper, borderRadius: 10, boxShadow: "0 18px 40px rgba(0,0,0,.45)", border: `1px solid ${COLORS.paperDark}`, overflow: "hidden" }}>
            <div style={{ background: COLORS.bgPanel2, padding: "12px 20px", display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: "#9fb0c4" }}>SCENARIO {scenario.id.slice(-6)}</span>
              <span style={{ background: DIFF_COLOR[scenario.fault.difficulty], color: "#fff", padding: "3px 10px", borderRadius: 999, fontSize: 12, fontFamily: "'IBM Plex Mono', monospace" }}>{scenario.fault.difficulty}</span>
            </div>
            <div style={{ padding: "20px 22px 24px", color: COLORS.ink }}>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: COLORS.label, marginBottom: 6 }}>EQUIPMENT: {equipmentLabel(scenario.config)}</div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11.5, color: COLORS.label, marginBottom: 14, lineHeight: 1.5 }}>
                CONDITIONS: {scenario.config.system === "cooling"
                  ? `Outdoor ${scenario.cond.outdoorTempF}°F, Indoor ${scenario.cond.indoorTempF}°F, RH ${scenario.cond.indoorRH}%, load ${scenario.cond.systemLoad}`
                  : `Outdoor ${scenario.cond.outdoorTempF}°F, Indoor ${scenario.cond.indoorTempF}°F`}
              </div>
              <div style={{ fontSize: 16, lineHeight: 1.5, fontWeight: 500, marginBottom: 18, paddingBottom: 14, borderBottom: `1px dashed ${COLORS.paperDark}` }}>
                &ldquo;{scenario.complaint}&rdquo;
              </div>

              <SequenceBar scenario={scenario} />
              <div style={sectionLabelStyle()}>Measurements</div>
              <ScenarioMeasurements scenario={scenario} />

              <HintsPanel key={scenario.id} hints={scenario.hints} />

              <div style={sectionLabelStyle()}>What's your diagnosis?</div>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your diagnosis in your own words, and briefly say why..."
                rows={3}
                disabled={!!result}
                style={{ width: "100%", padding: 10, borderRadius: 7, border: `1px solid ${COLORS.paperDark}`, fontSize: 14, fontFamily: "inherit" }}
              />

              {!result ? (
                <div style={{ marginTop: 14, textAlign: "right" }}>
                  <button
                    disabled={!answer.trim() || evaluating}
                    onClick={submit}
                    style={{ background: !answer.trim() || evaluating ? "#b9b39d" : COLORS.ink, color: COLORS.paper, border: "none", borderRadius: 7, padding: "11px 24px", fontSize: 14, fontWeight: 600, letterSpacing: ".04em", fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase", cursor: !answer.trim() || evaluating ? "default" : "pointer" }}
                  >
                    {evaluating ? "Evaluating…" : "Submit Diagnosis"}
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 16 }}>
                  <div style={{ padding: "14px 16px", borderRadius: 8, background: result.verdict === "correct" ? "#e6efe6" : result.verdict === "partial" ? "#fdf0da" : "#f3e3e0", border: `1px solid ${result.verdict === "correct" ? COLORS.green : result.verdict === "partial" ? COLORS.amber : COLORS.red}` }}>
                    <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700, fontSize: 15, textTransform: "uppercase", marginBottom: 6 }}>
                      {result.verdict === "correct" ? "Correct" : result.verdict === "partial" ? "Partially correct" : result.verdict === "error" ? "Evaluator error" : "Not quite"}
                    </div>
                    <div style={{ fontSize: 14, lineHeight: 1.55 }}>{result.explanation}</div>
                    {result.verdict !== "error" && (
                      <div style={{ fontSize: 12.5, marginTop: 8, color: COLORS.label }}>
                        Intended diagnosis: <b>{scenario.reasoning.primaryDiagnosis}</b>
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 14, textAlign: "right" }}>
                    <button onClick={newScenario} style={{ background: COLORS.amber, color: "#fff", border: "none", borderRadius: 7, padding: "11px 24px", fontSize: 14, fontWeight: 600, letterSpacing: ".04em", fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase", cursor: "pointer" }}>Next Call →</button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <DebugPanel scenario={scenario} />
        </div>
      )}
    </div>
  );
}

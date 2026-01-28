// js/content.js
const RARITY = {
common: { w: 70, c: "rgba(255,255,255,.72)" },
rare: { w: 24, c: "rgba(102,163,255,.85)" },
epic: { w: 6, c: "rgba(184,255,102,.85)" },
};


export function rarityColor(r) { return (RARITY[r]?.c) || "rgba(255,255,255,.7)"; }


export const ITEMS = [
// DPS
{ key:"dmg", icon:"assets/ui/up_dmg.png", delta:"+20% DMG", rarity:"common", title:"Damage +20%", tag:"DPS", desc:"기본 피해량 증가", apply(p){ p.stats.damage *= 1.20; } },
{ key:"firerate", icon:"assets/ui/up_firerate.png", delta:"+18% Fire Rate", rarity:"common", title:"Fire Rate +18%", tag:"DPS", desc:"발사 속도 증가", apply(p){ p.stats.fireRate *= 1.18; } },
{ key:"crit", icon:"assets/ui/up_crit.png", delta:"+6% Crit Chance", rarity:"rare", title:"Crit Chance +6%", tag:"DPS", desc:"치명타 확률 증가", apply(p){ p.stats.critChance = Math.min(0.6, p.stats.critChance + 0.06); } },
{ key:"critmult", icon:"assets/ui/up_crit.png", delta:"+0.3 Crit Mult", rarity:"rare", title:"Crit Mult +0.3", tag:"DPS", desc:"치명타 배율 증가", apply(p){ p.stats.critMult += 0.30; } },


// 생존
{ key:"hp", icon:"assets/ui/up_hp.png", delta:"+25 Max HP", rarity:"common", title:"Max HP +25", tag:"Survive", desc:"체력 상한 증가 + 즉시 회복", apply(p){ p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
{ key:"sh", icon:"assets/ui/up_sh.png", delta:"+20 Max SH", rarity:"common", title:"Max SH +20", tag:"Survive", desc:"실드 상한 증가 + 즉시 회복", apply(p){ p.maxSh += 20; p.sh = Math.min(p.maxSh, p.sh + 20); } },
{ key:"dash", icon:"assets/ui/up_dash.png", delta:"-20% Dash CD", rarity:"rare", title:"Dash Cooldown -20%", tag:"Survive", desc:"대시 쿨 감소", apply(p){ p.stats.dashCdMult *= 0.80; } },


// 탄 성능
{ key:"pierce", icon:"assets/ui/up_pierce.png", delta:"+1 Pierce", rarity:"rare", title:"Pierce +1", tag:"Build", desc:"관통 증가", apply(p){ p.stats.pierce += 1; p.stats.bulletSize += 0.35; } },
{ key:"speed", icon:"assets/ui/up_speed.png", delta:"+15% Bullet Speed", rarity:"common", title:"Bullet Speed +15%", tag:"Build", desc:"탄속 증가", apply(p){ p.stats.bulletSpeed *= 1.15; } },
{ key:"spread", icon:"assets/ui/up_accuracy.png", delta:"-20% Spread", rarity:"common", title:"Accuracy +20%", tag:"Build", desc:"탄 퍼짐 감소", apply(p){ p.stats.spread *= 0.80; } },


// 무기 언락/빌드 코어
{ key:"unlock_shotgun", icon:"assets/ui/icon_shotgun.png", delta:"Unlock Shotgun", rarity:"common", title:"Unlock: Shotgun", tag:"Weapon", desc:"샷건 사용 가능(2키)", apply(p,g){ if (p.unlockWeapon("shotgun")) g?.notifyWeaponUnlocked?.("shotgun"); } },
{ key:"unlock_rail", icon:"assets/ui/icon_rail.png", delta:"Unlock Rail", rarity:"rare", title:"Unlock: Rail Beam", tag:"Weapon", desc:"레일빔 사용 가능(3키)", apply(p,g){ if (p.unlockWeapon("rail")) g?.notifyWeaponUnlocked?.("rail"); } },
{ key:"unlock_crossbow", icon:"assets/ui/icon_crossbow.png", delta:"Unlock Crossbow", rarity:"rare", title:"Unlock: Crossbow", tag:"Weapon", desc:"크로스보우 사용 가능(4키)", apply(p,g){ if (p.unlockWeapon("crossbow")) g?.notifyWeaponUnlocked?.("crossbow"); } },

{ key:"pellets", icon:"assets/ui/icon_shotgun.png", delta:"+2 Pellets", rarity:"rare", title:"Pellets +2", tag:"Shotgun", desc:"샷건 펠릿 증가(폭딜 시너지)", requires:["shotgun"], apply(p){ p.stats.pellets += 2; } },
{ key:"shot_spread", icon:"assets/ui/icon_shotgun.png", delta:"-12% Shot Spread", rarity:"common", title:"Shotgun Spread -12%", tag:"Shotgun", desc:"샷건 퍼짐 감소(집탄)", requires:["shotgun"], apply(p){ p.stats.shotgunSpread *= 0.88; } },
{ key:"rail_width", icon:"assets/ui/icon_rail.png", delta:"+8 Beam Width", rarity:"epic", title:"Rail Width +8", tag:"Rail", desc:"레일빔 굵기 증가(라인 클리어)", requires:["rail"], apply(p){ p.stats.railWidth += 8; } },

{ key:"xbow_bolts", icon:"assets/ui/icon_crossbow.png", delta:"+1 Bolt", rarity:"common", title:"Bolts +1", tag:"Crossbow", desc:"크로스보우 볼트 1발 추가", requires:["crossbow"], apply(p){ p.stats.xbowBolts = Math.min(3, (p.stats.xbowBolts||1) + 1); } },
{ key:"xbow_draw", icon:"assets/ui/icon_crossbow.png", delta:"+20% Draw Speed", rarity:"rare", title:"Draw Speed +20%", tag:"Crossbow", desc:"크로스보우 발사 속도 증가", requires:["crossbow"], apply(p){ p.stats.xbowRate = (p.stats.xbowRate||1) * 1.20; } },
{ key:"xbow_pierce", icon:"assets/ui/icon_crossbow.png", delta:"+1 Bolt Pierce", rarity:"rare", title:"Bolt Pierce +1", tag:"Crossbow", desc:"크로스보우 볼트 관통 +1", requires:["crossbow"], apply(p){ p.stats.xbowPierce = Math.min(3, (p.stats.xbowPierce||0) + 1); } },


// 오브(자동 타격)
{ key:"orbs", icon:"assets/ui/up_orb.png", delta:"+1 Orb", rarity:"epic", title:"Orbit Orbs +1", tag:"Auto", desc:"플레이어 주위 오브가 자동 타격", apply(p){ p.stats.orbs = Math.min(4, p.stats.orbs + 1); } },


// 드랍/자석
{ key:"magnet", icon:"assets/ui/up_magnet.png", delta:"+25% Magnet", rarity:"common", title:"Magnet +25%", tag:"QoL", desc:"픽업 자석 범위 증가", apply(p){ p.stats.magnetMult *= 1.25; } },
{ key:"xp", icon:"assets/ui/up_xp.png", delta:"+20% XP", rarity:"rare", title:"XP Gain +20%", tag:"QoL", desc:"획득 XP 증가", apply(p){ p.stats.xpMult *= 1.20; } },


// 스킬: Aegis(우클릭 무적)
{ key:"aegis_cd", icon:"assets/ui/up_aegis.png", delta:"-20% Aegis CD", rarity:"rare", title:"Aegis Cooldown -20%", tag:"Skill", desc:"우클릭 무적 스킬 쿨타임 감소", apply(p){ p.stats.skillCdMult *= 0.80; } },
{ key:"aegis_dur", icon:"assets/ui/up_aegis.png", delta:"+0.4s Aegis Dur", rarity:"epic", title:"Aegis Duration +0.4s", tag:"Skill", desc:"우클릭 무적 스킬 지속시간 증가", apply(p){ p.stats.aegisDur = (p.stats.aegisDur||2.0) + 0.4; } },
{ key:"cdr", icon:"assets/ui/up_aegis.png", delta:"-15% Dash/Aegis CD", rarity:"epic", title:"Cooldowns -15%", tag:"Skill", desc:"대시/무적 쿨타임 동시 감소", apply(p){ p.stats.dashCdMult *= 0.85; p.stats.skillCdMult *= 0.85; } },
];


/* =========================
Upgrade rolling
- rarity weighted
========================= */
function rollRarity() {
const sum = RARITY.common.w + RARITY.rare.w + RARITY.epic.w;
let r = Math.random() * sum;
if ((r -= RARITY.common.w) < 0) return "common";
if ((r -= RARITY.rare.w) < 0) return "rare";
return "epic";
}


export function rollChoices(game, n = 3) {
  const p = game.player;

  function eligible(it) {
    // 무기 관련 업그레이드는 "가지고 있는 것"만 등장
    if (it.requires && Array.isArray(it.requires)) {
      for (const req of it.requires) {
        if (!p.hasWeapon(req)) return false;
      }
    }

    // 이미 언락된 무기는 언락 카드 제외
    if (it.key === "unlock_shotgun" && p.hasWeapon("shotgun")) return false;
    if (it.key === "unlock_rail" && p.hasWeapon("rail")) return false;
    if (it.key === "unlock_crossbow" && p.hasWeapon("crossbow")) return false;

    return true;
  }

// 중복 키 방지
const picks = [];
const used = new Set();


let guard = 0;
while (picks.length < n && guard++ < 200) {
const rar = rollRarity();
const pool = ITEMS.filter(it => it.rarity === rar && eligible(it));


const it = pool[Math.floor(Math.random() * pool.length)];
if (!it) continue;
if (used.has(it.key)) continue;


if (!eligible(it)) continue;


used.add(it.key);
picks.push(it);
}


// 부족하면 아무거나 채우기
const fallback = ITEMS.filter(it => !used.has(it.key) && eligible(it));
while (picks.length < n && fallback.length) {
const it = fallback.splice(Math.floor(Math.random() * fallback.length), 1)[0];
if (!it) break;
if (!eligible(it)) continue;
picks.push(it);
}


return picks.slice(0, n);
}
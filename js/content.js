// js/content.js
const RARITY = {
common: { w: 70, c: "rgba(255,255,255,.72)" },
rare: { w: 24, c: "rgba(102,163,255,.85)" },
epic: { w: 6, c: "rgba(184,255,102,.85)" },
};


export function rarityColor(r) { return (RARITY[r]?.c) || "rgba(255,255,255,.7)"; }


export const ITEMS = [
// DPS
{ key:"dmg", rarity:"common", title:"Damage +20%", tag:"DPS", desc:"기본 피해량 증가", apply(p){ p.stats.damage *= 1.20; } },
{ key:"firerate", rarity:"common", title:"Fire Rate +18%", tag:"DPS", desc:"발사 속도 증가", apply(p){ p.stats.fireRate *= 1.18; } },
{ key:"crit", rarity:"rare", title:"Crit Chance +6%", tag:"DPS", desc:"치명타 확률 증가", apply(p){ p.stats.critChance = Math.min(0.6, p.stats.critChance + 0.06); } },
{ key:"critmult", rarity:"rare", title:"Crit Mult +0.3", tag:"DPS", desc:"치명타 배율 증가", apply(p){ p.stats.critMult += 0.30; } },


// 생존
{ key:"hp", rarity:"common", title:"Max HP +25", tag:"Survive", desc:"체력 상한 증가 + 즉시 회복", apply(p){ p.maxHp += 25; p.hp = Math.min(p.maxHp, p.hp + 25); } },
{ key:"sh", rarity:"common", title:"Max SH +20", tag:"Survive", desc:"실드 상한 증가 + 즉시 회복", apply(p){ p.maxSh += 20; p.sh = Math.min(p.maxSh, p.sh + 20); } },
{ key:"dash", rarity:"rare", title:"Dash Cooldown -20%", tag:"Survive", desc:"대시 쿨 감소", apply(p){ p.stats.dashCdMult *= 0.80; } },


// 탄 성능
{ key:"pierce", rarity:"rare", title:"Pierce +1", tag:"Build", desc:"관통 증가", apply(p){ p.stats.pierce += 1; p.stats.bulletSize += 0.35; } },
{ key:"speed", rarity:"common", title:"Bullet Speed +15%", tag:"Build", desc:"탄속 증가", apply(p){ p.stats.bulletSpeed *= 1.15; } },
{ key:"spread", rarity:"common", title:"Accuracy +20%", tag:"Build", desc:"탄 퍼짐 감소", apply(p){ p.stats.spread *= 0.80; } },


// 무기 언락/빌드 코어
{ key:"unlock_shotgun", rarity:"common", title:"Unlock: Shotgun", tag:"Weapon", desc:"샷건 사용 가능(2키)", apply(p){ p.unlockWeapon("shotgun"); } },
{ key:"unlock_rail", rarity:"rare", title:"Unlock: Rail Beam", tag:"Weapon", desc:"레일빔 사용 가능(3키)", apply(p){ p.unlockWeapon("rail"); } },
{ key:"pellets", rarity:"rare", title:"Pellets +2", tag:"Shotgun", desc:"샷건 펠릿 증가(폭딜 시너지)", apply(p){ p.stats.pellets += 2; } },
{ key:"shot_spread", rarity:"common", title:"Shotgun Spread -12%", tag:"Shotgun", desc:"샷건 퍼짐 감소(집탄)", apply(p){ p.stats.shotgunSpread *= 0.88; } },
{ key:"rail_width", rarity:"epic", title:"Rail Width +8", tag:"Rail", desc:"레일빔 굵기 증가(라인 클리어)", apply(p){ p.stats.railWidth += 8; } },


// 오브(자동 타격)
{ key:"orbs", rarity:"epic", title:"Orbit Orbs +1", tag:"Auto", desc:"플레이어 주위 오브가 자동 타격", apply(p){ p.stats.orbs = Math.min(4, p.stats.orbs + 1); } },


// 드랍/자석
{ key:"magnet", rarity:"common", title:"Magnet +25%", tag:"QoL", desc:"픽업 자석 범위 증가", apply(p){ p.stats.magnetMult *= 1.25; } },
{ key:"xp", rarity:"rare", title:"XP Gain +20%", tag:"QoL", desc:"획득 XP 증가", apply(p){ p.stats.xpMult *= 1.20; } },


// 스킬(에너지) 강화
{ key:"energy", rarity:"common", title:"Energy Regen +25%", tag:"Skill", desc:"스킬 에너지 회복 속도 증가", apply(p){ p.stats.energyRegen *= 1.25; } },
{ key:"nova", rarity:"rare", title:"Nova Damage +35%", tag:"Skill", desc:"노바(우클릭) 피해 증가", apply(p){ p.stats.novaDmg *= 1.35; } },
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
// 중복 키 방지
const picks = [];
const used = new Set();


let guard = 0;
while (picks.length < n && guard++ < 200) {
const rar = rollRarity();
const pool = ITEMS.filter(it => it.rarity === rar);


const it = pool[Math.floor(Math.random() * pool.length)];
if (!it) continue;
if (used.has(it.key)) continue;


// 이미 언락된 무기 언락은 제외
if (it.key === "unlock_shotgun" && game.player.hasWeapon("shotgun")) continue;
if (it.key === "unlock_rail" && game.player.hasWeapon("rail")) continue;


used.add(it.key);
picks.push(it);
}


// 부족하면 아무거나 채우기
const fallback = ITEMS.filter(it => !used.has(it.key));
while (picks.length < n && fallback.length) {
const it = fallback.splice(Math.floor(Math.random() * fallback.length), 1)[0];
if (!it) break;
if (it.key === "unlock_shotgun" && game.player.hasWeapon("shotgun")) continue;
if (it.key === "unlock_rail" && game.player.hasWeapon("rail")) continue;
picks.push(it);
}


return picks.slice(0, n);
}
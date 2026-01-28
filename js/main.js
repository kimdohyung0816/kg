// js/main.js
import { Game } from "./world.js";

const canvas = document.getElementById("game");
const game = new Game(canvas);

const ui = {
  hpFill: document.getElementById("hpFill"),
  shFill: document.getElementById("shFill"),
  xpFill: document.getElementById("xpFill"),
  hpText: document.getElementById("hpText"),
  shText: document.getElementById("shText"),
  xpText: document.getElementById("xpText"),
  waveText: document.getElementById("waveText"),
  lvlText: document.getElementById("lvlText"),
  scoreText: document.getElementById("scoreText"),
  fpsText: document.getElementById("fpsText"),

  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayDesc: document.getElementById("overlayDesc"),
  cards: document.getElementById("cards"),

  menuArea: document.getElementById("menuArea"),
  bestWaveText: document.getElementById("bestWaveText"),
  bestScoreText: document.getElementById("bestScoreText"),
  diffPills: document.getElementById("diffPills"),
  diffDesc: document.getElementById("diffDesc"),
  unlockRow: document.getElementById("unlockRow"),

  weaponPills: document.getElementById("weaponPills"),
  weaponDesc: document.getElementById("weaponDesc"),

  volRange: document.getElementById("volRange"),
  volText: document.getElementById("volText"),
  shakeRange: document.getElementById("shakeRange"),
  shakeText: document.getElementById("shakeText"),

  tutorialArea: document.getElementById("tutorialArea"),
  buildSummary: document.getElementById("buildSummary"),

  btnStart: document.getElementById("btnStart"),
  btnResume: document.getElementById("btnResume"),
  btnRestart: document.getElementById("btnRestart"),
};

game.bindUI(ui);
game.openMenu();
game.start();

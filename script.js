(() => {
  "use strict";

  // Réglages du jeu et de son classement local.
  const GAME_DURATION_SECONDS = 30;
  const GAME_DURATION_MILLISECONDS = GAME_DURATION_SECONDS * 1000;
  const STORAGE_KEY = "agora-click-challenge-scores-v1";
  const MAX_PLAYER_NAME_LENGTH = 18;
  const MAX_STORED_SCORES = 100;
  const VISIBLE_SCORE_COUNT = 5;

  const elements = {
    scoreValue: document.getElementById("score-value"),
    timerValue: document.getElementById("timer-value"),
    timerTrack: document.getElementById("timer-track"),
    timerProgress: document.getElementById("timer-progress"),
    gameArea: document.getElementById("game-area"),
    arenaIntro: document.getElementById("arena-instructions"),
    target: document.getElementById("target"),
    resultOverlay: document.getElementById("result-overlay"),
    finalScore: document.getElementById("final-score"),
    resultMessage: document.getElementById("result-message"),
    scoreForm: document.getElementById("score-form"),
    playerName: document.getElementById("player-name"),
    saveScoreButton: document.getElementById("save-score-button"),
    saveFeedback: document.getElementById("save-feedback"),
    startButton: document.getElementById("start-button"),
    startLabel: document.getElementById("start-label"),
    gameStatus: document.getElementById("game-status"),
    leaderboardList: document.getElementById("leaderboard-list"),
    leaderboardStatus: document.getElementById("leaderboard-status"),
    personalBest: document.getElementById("personal-best"),
    clearScoresButton: document.getElementById("clear-scores-button"),
    installButton: document.getElementById("install-app-button"),
    offlineStatus: document.getElementById("offline-status"),
  };

  const missingElements = Object.entries(elements)
    .filter(([, element]) => !element)
    .map(([name]) => name);

  if (missingElements.length > 0) {
    console.error(
      "AGORA Click Challenge : éléments HTML introuvables.",
      missingElements,
    );
    return;
  }

  const state = {
    score: 0,
    isRunning: false,
    hasFinished: false,
    resultSaved: false,
    countdownIntervalId: null,
    gameEndsAt: 0,
    lastAnnouncedSecond: null,
    storageWarning: false,
  };
  let deferredInstallPrompt = null;

  function registerOfflineSupport() {
    if (!window.isSecureContext || !("serviceWorker" in navigator)) {
      elements.offlineStatus.textContent = "Hors ligne indisponible";
      return;
    }

    navigator.serviceWorker
      .register("./service-worker.js")
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        elements.offlineStatus.textContent = "Hors ligne prêt";
      })
      .catch((error) => {
        console.error(
          "AGORA Click Challenge : impossible de préparer le mode hors ligne.",
          error,
        );
        elements.offlineStatus.textContent = "Hors ligne indisponible";
      });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
  });

  elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) {
      const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const installInstructions = isAppleMobile
        ? "Sur iPhone ou iPad, touche Partager puis « Sur l’écran d’accueil »."
        : "Ouvre le menu de ton navigateur et choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».";
      window.alert(
        `${installInstructions} Le site doit être hébergé en HTTPS.`,
      );
      return;
    }

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });

  window.addEventListener("appinstalled", () => {
    elements.installButton.hidden = true;
  });

  if (window.matchMedia("(display-mode: standalone)").matches) {
    elements.installButton.hidden = true;
  }

  // Nettoie et limite le pseudonyme sans jamais l'interpréter comme du HTML.
  function normalizePlayerName(value) {
    return value.trim().replace(/\s+/g, " ").slice(0, MAX_PLAYER_NAME_LENGTH);
  }

  // Les entrées persistées sont validées avant tout affichage.
  function normalizeScoreEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }

    if (
      typeof entry.name !== "string" ||
      !Number.isSafeInteger(entry.score) ||
      entry.score < 0
    ) {
      return null;
    }

    const name = normalizePlayerName(entry.name);
    const timestamp =
      typeof entry.date === "string" ? Date.parse(entry.date) : Number.NaN;

    if (!name || Number.isNaN(timestamp)) {
      return null;
    }

    return {
      name,
      score: entry.score,
      date: new Date(timestamp).toISOString(),
    };
  }

  function compareScores(first, second) {
    if (first.score !== second.score) {
      return second.score - first.score;
    }

    return Date.parse(first.date) - Date.parse(second.date);
  }

  function readStoredScores() {
    state.storageWarning = false;

    try {
      const storedValue = window.localStorage.getItem(STORAGE_KEY);

      if (!storedValue) {
        return [];
      }

      const parsedScores = JSON.parse(storedValue);

      if (!Array.isArray(parsedScores)) {
        state.storageWarning = true;
        return [];
      }

      return parsedScores
        .map(normalizeScoreEntry)
        .filter((entry) => entry !== null)
        .sort(compareScores)
        .slice(0, MAX_STORED_SCORES);
    } catch (error) {
      // Le jeu reste jouable même si le stockage est bloqué ou corrompu.
      state.storageWarning = true;
      return [];
    }
  }

  function formatScoreDate(isoDate) {
    try {
      return new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "short",
      }).format(new Date(isoDate));
    } catch (error) {
      return "Date inconnue";
    }
  }

  function renderLeaderboard(scores = readStoredScores()) {
    const visibleScores = [...scores]
      .sort(compareScores)
      .slice(0, VISIBLE_SCORE_COUNT);
    elements.leaderboardList.replaceChildren();
    elements.personalBest.textContent =
      visibleScores.length > 0 ? String(visibleScores[0].score) : "—";

    if (visibleScores.length === 0) {
      const emptyItem = document.createElement("li");
      emptyItem.className = "leaderboard__empty";
      emptyItem.textContent =
        "Tes scores apparaîtront ici après ta première partie.";
      elements.leaderboardList.append(emptyItem);
    } else {
      visibleScores.forEach((entry, index) => {
        const item = document.createElement("li");
        item.className =
          index === 0
            ? "leaderboard__item leaderboard__item--first"
            : "leaderboard__item";

        const rank = document.createElement("span");
        rank.className = "leaderboard__rank";
        rank.textContent = String(index + 1).padStart(2, "0");
        rank.setAttribute("aria-label", `Rang ${index + 1}`);

        const identity = document.createElement("span");
        identity.className = "leaderboard__identity";

        const name = document.createElement("span");
        name.className = "leaderboard__name";
        name.textContent = entry.name;

        const date = document.createElement("time");
        date.className = "leaderboard__date";
        date.dateTime = entry.date;
        date.textContent = formatScoreDate(entry.date);

        const score = document.createElement("span");
        score.className = "leaderboard__score";
        score.textContent = `${entry.score} pts`;

        identity.append(name, date);
        item.append(rank, identity, score);
        elements.leaderboardList.append(item);
      });
    }

    if (state.storageWarning) {
      elements.leaderboardStatus.textContent =
        "Le classement local est illisible ou indisponible. Tu peux quand même jouer.";
    } else if (visibleScores.length === 0) {
      elements.leaderboardStatus.textContent =
        "Les scores sont conservés uniquement dans ce navigateur.";
    } else {
      elements.leaderboardStatus.textContent =
        "Classement enregistré uniquement sur cet appareil.";
    }
  }

  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function clearCountdown() {
    if (state.countdownIntervalId !== null) {
      window.clearInterval(state.countdownIntervalId);
      state.countdownIntervalId = null;
    }
  }

  // Place le centre de la cible dans les limites utiles de l'arène.
  function moveTarget() {
    const areaWidth = elements.gameArea.clientWidth;
    const areaHeight = elements.gameArea.clientHeight;
    const targetSize = elements.target.getBoundingClientRect().width || 64;

    if (areaWidth <= 0 || areaHeight <= 0) {
      return;
    }

    const horizontalInset = 12;
    const verticalInset = 12;
    const minimumX = targetSize / 2 + horizontalInset;
    const maximumX = Math.max(
      minimumX,
      areaWidth - targetSize / 2 - horizontalInset,
    );
    const minimumY = Math.min(
      targetSize / 2 + 52,
      areaHeight - targetSize / 2 - verticalInset,
    );
    const maximumY = Math.max(
      minimumY,
      areaHeight - targetSize / 2 - verticalInset,
    );

    const randomX = minimumX + Math.random() * (maximumX - minimumX);
    const randomY = minimumY + Math.random() * (maximumY - minimumY);

    elements.target.style.left = `${randomX}px`;
    elements.target.style.top = `${randomY}px`;
  }

  function updateCountdown() {
    if (!state.isRunning) {
      return;
    }

    const millisecondsRemaining = Math.max(0, state.gameEndsAt - Date.now());
    const secondsRemaining = Math.ceil(millisecondsRemaining / 1000);
    const progressPercent =
      (millisecondsRemaining / GAME_DURATION_MILLISECONDS) * 100;

    elements.timerValue.textContent = formatTime(secondsRemaining);
    elements.timerProgress.style.width = `${progressPercent}%`;
    elements.timerTrack.setAttribute("aria-valuenow", String(secondsRemaining));

    if (state.lastAnnouncedSecond !== secondsRemaining) {
      const secondWord = secondsRemaining === 1 ? "seconde" : "secondes";
      elements.timerTrack.setAttribute(
        "aria-valuetext",
        `${secondsRemaining} ${secondWord} restantes`,
      );
      state.lastAnnouncedSecond = secondsRemaining;
    }

    if (millisecondsRemaining === 0) {
      finishGame();
    }
  }

  function getResultMessage(finalScore) {
    if (finalScore === 0) {
      return "La cible s’est échappée cette fois. Relance une partie et vise le prochain mouvement.";
    }

    if (finalScore < 10) {
      return "Belle mise en jambes. Quelques clics de plus et le record est à portée.";
    }

    if (finalScore < 20) {
      return "Bien joué : tes réflexes sont au rendez-vous. Peux-tu faire encore mieux ?";
    }

    return "Excellents réflexes. Une performance solide à inscrire au classement.";
  }

  function finishGame() {
    if (!state.isRunning) {
      return;
    }

    state.isRunning = false;
    state.hasFinished = true;
    state.resultSaved = false;
    clearCountdown();

    elements.timerValue.textContent = "00:00";
    elements.timerProgress.style.width = "0%";
    elements.timerTrack.setAttribute("aria-valuenow", "0");
    elements.timerTrack.setAttribute("aria-valuetext", "0 seconde restante");
    elements.target.hidden = true;
    elements.resultOverlay.hidden = false;
    elements.finalScore.textContent = String(state.score);
    elements.resultMessage.textContent = getResultMessage(state.score);
    elements.scoreForm.reset();
    elements.playerName.disabled = false;
    elements.saveScoreButton.disabled = false;
    elements.saveFeedback.textContent = "";
    elements.startButton.disabled = false;
    elements.startLabel.textContent = "Rejouer";
    elements.gameStatus.textContent = `Temps écoulé. Ton score final est de ${state.score} point${state.score === 1 ? "" : "s"}.`;

    // Le champ est rendu visible avant de recevoir le focus clavier.
    elements.playerName.focus({ preventScroll: true });
  }

  function startGame() {
    // Cette garde empêche tout double démarrage du compte à rebours.
    if (state.isRunning) {
      return;
    }

    clearCountdown();
    state.score = 0;
    state.isRunning = true;
    state.hasFinished = false;
    state.resultSaved = false;
    state.gameEndsAt = Date.now() + GAME_DURATION_MILLISECONDS;
    state.lastAnnouncedSecond = null;

    elements.scoreValue.textContent = "0";
    elements.timerValue.textContent = formatTime(GAME_DURATION_SECONDS);
    elements.timerProgress.style.width = "100%";
    elements.timerTrack.setAttribute(
      "aria-valuenow",
      String(GAME_DURATION_SECONDS),
    );
    elements.timerTrack.setAttribute(
      "aria-valuetext",
      `${GAME_DURATION_SECONDS} secondes restantes`,
    );
    elements.arenaIntro.hidden = true;
    elements.resultOverlay.hidden = true;
    elements.target.hidden = false;
    elements.scoreForm.reset();
    elements.playerName.disabled = false;
    elements.saveScoreButton.disabled = false;
    elements.saveFeedback.textContent = "";
    elements.startButton.disabled = true;
    elements.startLabel.textContent = "Partie en cours";
    elements.gameStatus.textContent =
      "La partie est lancée. Clique sur la cible rouge.";

    moveTarget();
    updateCountdown();
    state.countdownIntervalId = window.setInterval(updateCountdown, 100);
  }

  function handleTargetClick() {
    if (!state.isRunning) {
      return;
    }

    // Vérification supplémentaire : un clic après l'échéance ne rapporte rien,
    // même si le navigateur a retardé le prochain tick du chronomètre.
    if (Date.now() >= state.gameEndsAt) {
      finishGame();
      return;
    }

    state.score += 1;
    elements.scoreValue.textContent = String(state.score);
    moveTarget();
  }

  function saveFinalScore(event) {
    event.preventDefault();

    if (!state.hasFinished || state.resultSaved) {
      return;
    }

    const playerName = normalizePlayerName(elements.playerName.value);

    if (!playerName) {
      elements.saveFeedback.textContent =
        "Saisis un pseudonyme pour enregistrer ton score.";
      elements.playerName.focus();
      return;
    }

    const newEntry = {
      name: playerName,
      score: state.score,
      date: new Date().toISOString(),
    };
    const allScores = [...readStoredScores(), newEntry]
      .sort(compareScores)
      .slice(0, MAX_STORED_SCORES);

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(allScores));
      state.storageWarning = false;
      state.resultSaved = true;
      renderLeaderboard(allScores);
      elements.playerName.disabled = true;
      elements.saveScoreButton.disabled = true;
      elements.saveFeedback.textContent = "Score enregistré sur cet appareil.";
    } catch (error) {
      state.storageWarning = true;
      elements.leaderboardStatus.textContent =
        "Le navigateur ne permet pas l’écriture du classement local.";
      elements.saveFeedback.textContent =
        "Impossible d’enregistrer ici. Le jeu reste disponible.";
    }
  }

  function clearLeaderboard() {
    const confirmed = window.confirm(
      "Effacer tous les meilleurs scores enregistrés dans ce navigateur ?",
    );

    if (!confirmed) {
      return;
    }

    try {
      window.localStorage.removeItem(STORAGE_KEY);
      state.storageWarning = false;
      renderLeaderboard([]);
      elements.leaderboardStatus.textContent = "Le classement a été effacé.";
    } catch (error) {
      state.storageWarning = true;
      elements.leaderboardStatus.textContent =
        "Impossible d’effacer le classement dans ce navigateur.";
    }
  }

  elements.startButton.addEventListener("click", startGame);
  elements.target.addEventListener("click", handleTargetClick);
  elements.scoreForm.addEventListener("submit", saveFinalScore);
  elements.clearScoresButton.addEventListener("click", clearLeaderboard);

  window.addEventListener("resize", () => {
    if (state.isRunning) {
      moveTarget();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.isRunning) {
      updateCountdown();
    }
  });

  renderLeaderboard();
  registerOfflineSupport();
})();

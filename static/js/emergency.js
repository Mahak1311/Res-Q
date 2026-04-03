const sosButton = document.getElementById("sosButton");
const statusText = document.getElementById("statusText");
const messageFeed = document.getElementById("messageFeed");
const strengthFill = document.getElementById("strengthFill");
const strengthValue = document.getElementById("strengthValue");
const locationText = document.getElementById("locationText");
const callModeText = document.getElementById("callModeText");
const finalBadge = document.getElementById("finalBadge");
const attemptTableBody = document.querySelector("#attemptTable tbody");
const modeButtons = document.querySelectorAll(".mode-btn");

let activeMode = "mobile";

const randomBangalorePoint = () => ({
  lat: 12.90 + Math.random() * 0.13,
  lng: 77.53 + Math.random() * 0.19,
});

function speakMessage(text) {
  if (!("speechSynthesis" in window)) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.05;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function setFinalBadge(status) {
  finalBadge.className = "status-badge";
  if (status === "connected") {
    finalBadge.classList.add("good");
  } else if (status === "fallback_sent") {
    finalBadge.classList.add("warn");
  } else if (status === "unresolved") {
    finalBadge.classList.add("bad");
  } else {
    finalBadge.classList.add("neutral");
  }
  finalBadge.textContent = status.replace("_", " ");
}

function renderAttempts(attempts) {
  attemptTableBody.innerHTML = "";
  attempts.forEach((a) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${a.attempt}</td>
      <td>${a.center_name}</td>
      <td>${a.distance_km} km</td>
      <td><span class="chip ${a.status === "connected" ? "good" : "bad"}">${a.status}</span></td>
      <td>${a.reason || "-"}</td>
    `;
    attemptTableBody.appendChild(tr);
  });
}

function addMessage(message, type = "neutral") {
  const item = document.createElement("li");
  item.className = `feed-item ${type}`;
  item.textContent = message;
  messageFeed.prepend(item);
}

function setStrength(strength) {
  strengthValue.textContent = `${strength}%`;
  strengthFill.style.width = `${strength}%`;
  strengthFill.className = "";
  if (strength > 65) {
    strengthFill.classList.add("signal-good");
  } else if (strength > 35) {
    strengthFill.classList.add("signal-medium");
  } else {
    strengthFill.classList.add("signal-low");
  }
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ ...randomBangalorePoint(), source: "mock" });
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          source: "geolocation",
        });
      },
      () => resolve({ ...randomBangalorePoint(), source: "mock" }),
      { timeout: 5000 }
    );
  });
}

function setActiveMode(mode) {
  activeMode = mode;
  modeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.mode === mode);
  });
  if (callModeText) {
    callModeText.textContent = mode === "voip" ? "VoIP call selected" : "Mobile call selected";
  }
}

async function triggerEmergency() {
  sosButton.disabled = true;
  sosButton.classList.add("active");
  statusText.textContent = "Attempting to connect...";
  messageFeed.innerHTML = "";
  attemptTableBody.innerHTML = "";
  setFinalBadge("connecting");

  const location = await getLocation();
  locationText.textContent = `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)} (${location.source})`;

  const response = await fetch("/api/emergency/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...location, source: activeMode }),
  });

  if (!response.ok) {
    statusText.textContent = "Unable to process emergency request.";
    addMessage("System error while simulating emergency call.", "bad");
    setFinalBadge("unresolved");
    sosButton.disabled = false;
    sosButton.classList.remove("active");
    return;
  }

  const data = await response.json();
  setStrength(data.network.strength);
  renderAttempts(data.attempts);

  for (let i = 0; i < data.messages.length; i += 1) {
    const msg = data.messages[i];
    await new Promise((r) => setTimeout(r, 850));

    let type = "neutral";
    if (/connected/i.test(msg)) {
      type = "good";
    } else if (/rerouting|alternate|timeout|failed|dropped/i.test(msg)) {
      type = "warn";
    }

    addMessage(msg, type);
    statusText.textContent = msg;

    if (/rerouting|alternate|connected|fallback/i.test(msg)) {
      speakMessage(msg);
    }
  }

  setFinalBadge(data.final_status);

  if (data.final_status === "connected") {
    addMessage(`Connected center: ${data.final_center.name}`, "good");
  } else if (data.fallback) {
    addMessage(`Fallback ${data.fallback.channel} status: ${data.fallback.status}`, "warn");
  }

  sosButton.disabled = false;
  sosButton.classList.remove("active");
}

if (sosButton) {
  sosButton.addEventListener("click", triggerEmergency);
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => setActiveMode(button.dataset.mode));
});

setActiveMode(activeMode);

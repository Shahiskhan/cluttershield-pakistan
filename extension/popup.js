const statusNode = document.getElementById("feed-status");
const form = document.getElementById("check-form");
const input = document.getElementById("url-input");
const resultNode = document.getElementById("result");
const refreshButton = document.getElementById("refresh");
const navigationButton = document.getElementById("navigation-protection");

function humanize(value) {
  return String(value ?? "unavailable").replaceAll("_", " ");
}

function showFeedStatus(status) {
  const protection = status?.protection ?? "unavailable";
  const version = status?.feedVersion ? ` · version ${status.feedVersion}` : "";
  statusNode.textContent = `Protection ${humanize(protection)}${version}`;
}

function showResult(result) {
  resultNode.replaceChildren();
  resultNode.hidden = false;
  resultNode.className = result?.match ? "result warning" : "result";
  const heading = document.createElement("h2");
  heading.textContent = result?.error ? "Check unavailable" : result?.match ? "Reviewed risk indicator found" : "No match found";
  const message = document.createElement("p");
  message.textContent = result?.error
    ? "Enter a valid HTTP or HTTPS link, or a Pakistan/international phone number."
    : result?.message ?? "A check could not be completed.";
  resultNode.append(heading, message);
  if (result?.match) {
    const advisory = document.createElement("p");
    advisory.textContent = result.match.advisory;
    resultNode.append(advisory);
    const confidence = document.createElement("p");
    confidence.textContent = `Confidence: ${humanize(result.match.confidence)}.`;
    resultNode.append(confidence);
  }
  if (result?.protection === "unavailable" || result?.protection === "degraded") {
    const degraded = document.createElement("p");
    degraded.textContent = "An unknown or new scam may not appear in the feed. Never share a password, PIN, or OTP.";
    resultNode.append(degraded);
  }
}

function getStatus() {
  chrome.runtime.sendMessage({ type: "GET_FEED_STATUS" }, showFeedStatus);
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  resultNode.hidden = true;
  chrome.runtime.sendMessage({ type: "CHECK_USER_URL", value: input.value }, showResult);
});

refreshButton.addEventListener("click", () => {
  refreshButton.disabled = true;
  statusNode.textContent = "Refreshing…";
  chrome.runtime.sendMessage({ type: "REFRESH_FEED" }, (status) => {
    showFeedStatus(status);
    refreshButton.disabled = false;
  });
});

function showNavigationProtection(state) {
  navigationButton.textContent = state?.enabled ? "Local navigation checks enabled" : "Enable local navigation checks";
}
navigationButton.addEventListener("click", () => {
  navigationButton.disabled = true;
  chrome.permissions.request({
    permissions: ["webNavigation", "tabs"],
    origins: ["http://*/*", "https://*/*"],
  }).then((granted) => {
    showNavigationProtection({ enabled: granted });
    navigationButton.disabled = false;
  });
});
chrome.runtime.sendMessage({ type: "GET_NAVIGATION_PROTECTION" }, showNavigationProtection);

getStatus();

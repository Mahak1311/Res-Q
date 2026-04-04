(function () {
  const navEntry = performance.getEntriesByType("navigation")[0];
  const isReload = navEntry
    ? navEntry.type === "reload"
    : window.performance.navigation && window.performance.navigation.type === 1;

  if (isReload && window.location.pathname !== "/") {
    const blockedNextPaths = new Set(["/ai", "/ai-decision-engine"]);
    const nextPath = blockedNextPaths.has(window.location.pathname)
      ? "/home"
      : `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = nextPath || "/home";
    window.location.replace(`/?next=${encodeURIComponent(next)}`);
    return;
  }

  const clock = document.getElementById("liveClock");
  if (clock) {
    const updateClock = () => {
      const now = new Date();
      clock.textContent = now.toLocaleTimeString();
      clock.classList.remove("tick");
      requestAnimationFrame(() => {
        clock.classList.add("tick");
      });
    };
    updateClock();
    setInterval(updateClock, 1000);
  }

  const currentPath = window.location.pathname;
  document.querySelectorAll(".main-nav a").forEach((a) => {
    if (a.getAttribute("href") === currentPath) {
      a.classList.add("active");
    }
  });
})();

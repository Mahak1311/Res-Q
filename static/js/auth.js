(function () {
  const shell = document.querySelector(".auth-layout");
  if (!shell) {
    return;
  }

  const nextPath = shell.getAttribute("data-next") || "/dashboard";
  const errorNode = document.getElementById("authError");

  const showError = (message) => {
    if (!errorNode) return;
    errorNode.textContent = message || "";
    errorNode.classList.toggle("visible", Boolean(message));
  };

  const activeTab = (tabName) => {
    document.querySelectorAll(".auth-tab").forEach((tab) => {
      const isActive = tab.getAttribute("data-tab") === tabName;
      tab.classList.toggle("active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
    });

    document.querySelectorAll(".auth-tab-panel").forEach((panel) => {
      panel.classList.toggle("active", panel.getAttribute("data-panel") === tabName);
    });
  };

  document.querySelectorAll(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      showError("");
      activeTab(tab.getAttribute("data-tab"));
    });
  });

  const sendAuthRequest = async (url, body) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, next: nextPath }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || "Authentication failed");
    }
    window.location.assign(data.redirect || "/dashboard");
  };

  const wireForm = (id, endpoint) => {
    const form = document.getElementById(id);
    if (!form) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      showError("");
      const formData = new FormData(form);
      const payload = Object.fromEntries(formData.entries());
      try {
        await sendAuthRequest(endpoint, payload);
      } catch (error) {
        showError(error.message);
      }
    });
  };

  wireForm("emailSignupForm", "/api/auth/signup-email");
  wireForm("emailLoginForm", "/api/auth/login-email");
  wireForm("phoneSignupForm", "/api/auth/signup-phone");
  wireForm("phoneLoginForm", "/api/auth/login-phone");

  window.handleGoogleCredentialResponse = async (response) => {
    showError("");
    try {
      await sendAuthRequest("/api/auth/google", { credential: response.credential });
    } catch (error) {
      showError(error.message);
    }
  };
})();

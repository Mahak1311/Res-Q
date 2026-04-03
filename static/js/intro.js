(function () {
	const shell = document.getElementById("introShell");
	const panel = document.getElementById("introPanel");
	const title = document.getElementById("brandTitle");
	const tagline = document.getElementById("tagline");
	const startButton = document.getElementById("startButton");

	const params = new URLSearchParams(window.location.search);
	const requestedNext = params.get("next") || "/home";
	const safeNext = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/home";
	const targetUrl = safeNext === "/" ? "/home" : safeNext;

	if (startButton) {
		startButton.setAttribute("href", targetUrl);
	}

	setTimeout(() => {
		panel.classList.add("visible");
	}, 80);

	setTimeout(() => {
		title.classList.add("visible");
	}, 1500);

	setTimeout(() => {
		tagline.classList.add("visible");
	}, 1850);

	setTimeout(() => {
		startButton.classList.add("visible");
	}, 2600);

	setTimeout(() => {
		shell.classList.add("fade-out");
		setTimeout(() => {
			window.location.href = targetUrl;
		}, 520);
	}, 8200);
})();

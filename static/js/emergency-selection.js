const selectionScroll = document.getElementById("selectionScroll");
const revealCards = document.querySelectorAll(".scroll-reveal");

if (selectionScroll) {
  selectionScroll.addEventListener("click", (event) => {
    event.preventDefault();
    const target = document.getElementById("emergencyTypeGrid");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }
        entry.target.classList.add("show");
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.2,
      rootMargin: "0px 0px -8% 0px",
    }
  );

  revealCards.forEach((card) => observer.observe(card));
} else {
  revealCards.forEach((card) => card.classList.add("show"));
}

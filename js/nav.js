(function () {
  var toggle = document.getElementById("nav-toggle");
  var nav = document.getElementById("site-nav") || document.querySelector(".site-nav");
  if (!toggle || !nav) return;
  if (!nav.id) nav.id = "site-nav";
  toggle.setAttribute("aria-controls", nav.id);

  function setOpen(open) {
    nav.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  toggle.addEventListener("click", function (ev) {
    ev.stopPropagation();
    setOpen(!nav.classList.contains("is-open"));
  });

  nav.addEventListener("click", function (ev) {
    if (ev.target && ev.target.closest && ev.target.closest("a")) setOpen(false);
  });

  document.addEventListener("click", function (ev) {
    if (!nav.classList.contains("is-open")) return;
    if (ev.target.closest && (ev.target.closest(".site-nav") || ev.target.closest(".nav-toggle"))) return;
    setOpen(false);
  });

  window.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") setOpen(false);
  });
})();

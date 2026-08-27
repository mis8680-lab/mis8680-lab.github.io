document.addEventListener("click", function (event) {
  var link = event.target.closest("a[data-ga-event]");
  if (!link || typeof gtag !== "function") return;
  gtag("event", link.getAttribute("data-ga-event"), {
    link_url: link.href,
  });
});

(function () {
  "use strict";
  var mq = window.matchMedia("(max-width: 760px)");
  function apply(isMobile) {
    var root = document.documentElement;
    root.classList.toggle("device-mobile", isMobile);
    root.classList.toggle("device-desktop", !isMobile);
  }
  apply(mq.matches);
  if (mq.addEventListener) mq.addEventListener("change", (e) => apply(e.matches));
  else if (mq.addListener) mq.addListener((e) => apply(e.matches));
})();

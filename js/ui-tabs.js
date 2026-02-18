(function(){
    function setTab(tab){
          document.querySelectorAll(".tabBtn").forEach(b=>b.classList.remove("active"));
          document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));
          document.querySelectorAll(".tab-pane").forEach(p=>p.classList.add("hidden"));

      document.querySelector(`.tabBtn[data-tab="${tab}"]`).classList.add("active");
          const pane = document.getElementById(`page${tab}`);
          if(pane){
            pane.classList.remove("hidden");
            // Optionally reset scroll position to top when switching tabs
            if(pane.scrollTop) pane.scrollTop = 0;
          }
    }

   document.addEventListener("click", (e)=>{
         const btn = e.target.closest(".tabBtn");
         if(!btn) return;
         setTab(btn.dataset.tab);
   });

   window.UI = window.UI || {};
    window.UI.setTab = setTab;
})();

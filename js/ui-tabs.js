(function(){
    function setTab(tab){
          document.querySelectorAll(".tabBtn").forEach(b=>b.classList.remove("active"));
          document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));

      const activeBtn = document.querySelector(`.tabBtn[data-tab="${tab}"]`);
      const activePage = document.getElementById(`page${tab}`);
      
      if(activeBtn) activeBtn.classList.add("active");
      if(activePage){
        activePage.classList.remove("hidden");
        // Reset content pane scroll position on tab change
        activePage.scrollTop = 0;
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

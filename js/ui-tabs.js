(function(){
    function setTab(tab){
          document.querySelectorAll(".tabBtn").forEach(b=>b.classList.remove("active"));
          document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));

      document.querySelector(`.tabBtn[data-tab="${tab}"]`).classList.add("active");
          const targetPage = document.getElementById(`page${tab}`);
          targetPage.classList.remove("hidden");
          
          // Reset horizontal scroll position on tab change
          targetPage.scrollLeft = 0;
          
          // Ensure body and html keep overflow-y hidden
          document.documentElement.style.overflowY = "hidden";
          document.body.style.overflowY = "hidden";
    }

   document.addEventListener("click", (e)=>{
         const btn = e.target.closest(".tabBtn");
         if(!btn) return;
         setTab(btn.dataset.tab);
   });

   window.UI = window.UI || {};
    window.UI.setTab = setTab;
})();

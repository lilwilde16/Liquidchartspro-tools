(function(){
    function setTab(tab){
          document.querySelectorAll(".tabBtn").forEach(b=>b.classList.remove("active"));
          document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));

      document.querySelector(`.tabBtn[data-tab="${tab}"]`).classList.add("active");
          document.getElementById(`page-${tab}`).classList.remove("hidden");
    }

   document.addEventListener("click", (e)=>{
         const btn = e.target.closest(".tabBtn");
         if(!btn) return;
         setTab(btn.dataset.tab);
   });

   window.UI = window.UI || {};
    window.UI.setTab = setTab;
})();

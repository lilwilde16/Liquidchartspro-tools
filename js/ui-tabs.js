(function(){
    function setTab(tab){
          document.querySelectorAll(".tab-btn").forEach(b=>b.classList.remove("active"));
          document.querySelectorAll(".tab-pane").forEach(p=>p.classList.add("hidden"));

      document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add("active");
          document.getElementById(`page${tab}`).classList.remove("hidden");
    }

   document.addEventListener("click", (e)=>{
         const btn = e.target.closest(".tab-btn");
         if(!btn) return;
         setTab(btn.dataset.tab);
   });

   window.UI = window.UI || {};
    window.UI.setTab = setTab;
})();

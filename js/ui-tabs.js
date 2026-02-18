(function(){
    function setTab(tabId){
        document.querySelectorAll(".tabBtn").forEach(b=>b.classList.remove("active"));
        document.querySelectorAll(".page").forEach(p=>p.classList.add("hidden"));

        const btn = document.getElementById(tabId);
        if(btn) btn.classList.add("active");
        
        // Convert tabId to pageId: tabHome -> pageHome, tabSettings -> pageSettings
        // Only replace 'tab' if it's at the start of the ID
        const pageId = tabId.startsWith("tab") ? "page" + tabId.slice(3) : tabId;
        const page = document.getElementById(pageId);
        if(page) page.classList.remove("hidden");
    }

    document.addEventListener("click", (e)=>{
        const btn = e.target.closest(".tabBtn");
        if(!btn || !btn.id) return;
        setTab(btn.id);
    });

    window.UI = window.UI || {};
    window.UI.setTab = setTab;
})();

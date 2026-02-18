(function(){
    const $ = (id)=>document.getElementById(id);
    
    function showPage(pageId){
        document.querySelectorAll("section").forEach(s=>s.style.display="none");
        const page = $(pageId);
        if(page) page.style.display="block";
    }
    
    function setTab(name){
        const tabs = ["Home","Settings","Strength","Backtest","Tools"];
        tabs.forEach((t)=>{
            const btn = $(`tab${t}`);
            const page = $(`page${t}`);
            if(btn){
                if(t === name) btn.classList.add("active");
                else btn.classList.remove("active");
            }
            if(page){
                page.style.display = (t === name) ? "block" : "none";
            }
        });
    }
    
    const tabs = ["Home","Settings","Strength","Backtest","Tools"];
    tabs.forEach((name)=>{
        const btn = $(`tab${name}`);
        if(btn){
            btn.onclick = ()=>setTab(name);
        }
    });
    
    setTab("Home");
    
    window.UI = window.UI || {};
    window.UI.setTab = setTab;
})();

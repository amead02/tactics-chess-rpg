
/* tc_logging.js — lightweight JSONL logger for tChess.
   Exposes: window.tLog = { startGame(header?), event(type, obj), download(filename?) }
*/
(function(){
  const buf = [];
  let gameId = null;
  let attached = false;

  function iso(){ return new Date().toISOString(); }

  function ensureButton(){
    if(attached) return;
    try{
      const hud = document.getElementById('hud');
      if(!hud) return;
      const btn = document.createElement('button');
      btn.className='btn btn--ghost';
      btn.textContent='⬇️ Download Log';
      btn.title='Download game log (JSONL)';
      btn.addEventListener('click', ()=> download());
      hud.appendChild(btn);
      attached = true;
    }catch(e){}
  }

  function startGame(header){
    gameId = (header && header.game_id) || (Math.random().toString(36).slice(2));
    buf.length = 0;
    buf.push({ t: iso(), type:'game_start', header: Object.assign({ game_id: gameId }, header||{}) });
    ensureButton();
  }

  function event(type, obj){
    buf.push(Object.assign({ t: iso(), type }, obj||{}));
  }

  function download(filename){
    const name = filename || (`tchess_log_${gameId||'session'}.jsonl`);
    const text = buf.map(o=> JSON.stringify(o)).join('\n') + '\n';
    const blob = new Blob([text], {type:'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(()=>{
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  window.tLog = { startGame, event, download };
})();

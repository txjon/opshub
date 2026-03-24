"use client";
import { T } from "@/lib/theme";

const PIPELINE_STAGES = [
  { id:"blanks_ordered", label:"Blanks Ordered", pct:10 },
  { id:"blanks_shipped", label:"Blanks Shipped", pct:25 },
  { id:"blanks_received", label:"Blanks Received", pct:40 },
  { id:"strikeoff_approval", label:"Strike-off", pct:55, gate:true },
  { id:"in_production", label:"In Production", pct:75 },
  { id:"shipped", label:"Shipped", pct:100 },
];
const DECO_COLORS = {
  screen_print:{bg:"#1e3a6e",text:"#4f8ef7"},
  embroidery:{bg:"#2d1f5e",text:"#a78bfa"},
  patch:{bg:"#3d2a08",text:"#f5a623"},
  cut_sew:{bg:"#085041",text:"#34c97a"},
};
const getPct = (s) => (PIPELINE_STAGES.find(p=>p.id===s)||{pct:0}).pct;
const tQty = (q) => Object.values(q||{}).reduce((a,v)=>a+v,0);

export function ProductionTab({ items, onUpdateItem }) {
  const card = {background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"1rem 1.25rem"};

  if (items.length===0) {
    return <div style={{...card,textAlign:"center",color:T.muted,padding:"2rem",fontSize:13}}>No items yet.</div>;
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      {items.map(item=>{
        const si=PIPELINE_STAGES.findIndex(s=>s.id===item.pipeline_stage);
        const pct=getPct(item.pipeline_stage||"blanks_ordered");
        const dc=DECO_COLORS[item.decoration_type||"screen_print"]||DECO_COLORS.screen_print;
        return (
          <div key={item.id} style={{...card,padding:0,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderBottom:`1px solid ${T.border}`}}>
              <div style={{flex:1}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:13,fontWeight:500}}>{item.name}</span>
                  {item.decoration_type&&<span style={{padding:"1px 7px",borderRadius:6,fontSize:11,fontWeight:500,background:dc.bg,color:dc.text}}>{item.decoration_type.replace(/_/g," ")}</span>}
                  {item.status==="tbd"&&<span style={{padding:"1px 7px",borderRadius:6,fontSize:11,fontWeight:500,background:"#FAEEDA",color:"#633806"}}>TBD</span>}
                </div>
                <div style={{fontSize:11,color:T.muted,marginTop:2}}>{item.decorator||"No decorator"} · {tQty(item.qtys||{}).toLocaleString()} units</div>
              </div>
              <div style={{fontSize:13,fontWeight:500,color:pct===100?"#3B6D11":"#0C447C"}}>{pct}%</div>
            </div>
            <div style={{height:3,background:T.surface}}>
              <div style={{height:"100%",width:pct+"%",background:pct===100?"#639922":"#378ADD",transition:"width 0.3s"}}/>
            </div>
            <div style={{padding:"10px 14px",display:"flex",gap:6,flexWrap:"wrap"}}>
              {PIPELINE_STAGES.map((stage,idx)=>{
                const done=si>=idx, active=item.pipeline_stage===stage.id;
                return (
                  <button key={stage.id}
                    onClick={()=>{
                      const newStage=stage.gate&&si===idx?PIPELINE_STAGES[idx+1]?.id||stage.id:stage.id;
                      onUpdateItem(item.id,{pipeline_stage:newStage,decorator_assignment_id:item.decorator_assignment_id});
                    }}
                    style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",borderRadius:6,fontSize:11,fontWeight:active?500:400,cursor:"pointer",border:"0.5px solid "+(done?"#185FA5":"var(--color-border-tertiary)"),background:active?"#E6F1FB":done?"#E6F1FB66":"transparent",color:done?"#0C447C":"var(--color-text-secondary)"}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:done?"#378ADD":"var(--color-border-secondary)",flexShrink:0}}/>
                    {stage.label}
                    {stage.gate&&active&&<span style={{fontSize:10,background:"#FAEEDA",color:"#854F0B",padding:"1px 5px",borderRadius:6,marginLeft:2}}>Approve</span>}
                  </button>
                );
              })}
            </div>
            {item.pipeline_stage==="shipped"&&(
              <div style={{margin:"0 14px 10px",padding:"8px 12px",background:"#EAF3DE",border:"0.5px solid #C0DD97",borderRadius:6,fontSize:12,color:"#27500A"}}>
                Handed off to Receiving — log inbound details in the Warehouse tab
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkeletonRows } from "@/components/Skeleton";
import Link from "next/link";

type Client = { id:string; name:string; client_type:string|null; default_terms:string|null; notes:string|null; };
type Contact = { id:string; name:string; email:string|null; phone:string|null; role_label:string|null; is_primary:boolean; };
type Job = { id:string; title:string; job_number:string; phase:string; target_ship_date:string|null; costing_summary:any; items:any[]; payment_records:any[]; };

const PHASE_COLORS: Record<string,{bg:string,text:string}> = {
  intake:{bg:T.faint,text:T.muted}, pre_production:{bg:"#2d1f5e",text:"#a78bfa"},
  production:{bg:T.accentDim,text:T.accent}, receiving:{bg:T.amberDim,text:T.amber},
  shipping:{bg:T.greenDim,text:T.green}, complete:{bg:T.greenDim,text:T.green},
  on_hold:{bg:T.redDim,text:T.red}, cancelled:{bg:T.faint,text:T.muted},
};
const ic = {width:"100%",padding:"6px 10px",border:`1px solid ${T.border}`,borderRadius:6,background:T.surface,color:T.text,fontSize:"13px",fontFamily:font,boxSizing:"border-box" as const,outline:"none"};

export default function ClientDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const router = useRouter();
  const [client, setClient] = useState<Client|null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingContact, setAddingContact] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<Contact|null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(() => { load(); }, [params.id]);

  async function load() {
    setLoading(true);
    const [cRes, ctRes, jRes] = await Promise.all([
      supabase.from("clients").select("*").eq("id", params.id).single(),
      supabase.from("contacts").select("*").eq("client_id", params.id).order("name"),
      supabase.from("jobs").select("*, costing_summary, items(id, buy_sheet_lines(qty_ordered)), payment_records(amount, status, due_date)").eq("client_id", params.id).order("created_at", { ascending: false }),
    ]);
    if (cRes.data) setClient(cRes.data);
    if (ctRes.data) setContacts(ctRes.data as Contact[]);
    if (jRes.data) setJobs(jRes.data as Job[]);
    setLoading(false);
  }

  function updateClient(updates: Partial<Client>) {
    setClient(c => c ? {...c, ...updates} : c);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await supabase.from("clients").update(updates).eq("id", params.id);
    }, 1500);
  }

  if (loading) return (
    <div style={{padding:"2rem"}}>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <SkeletonRows rows={4} />
    </div>
  );
  if (!client) return <div style={{padding:"2rem",color:T.muted,fontSize:13}}>Client not found.</div>;

  const totalRev = jobs.reduce((a,j) => a + (j.costing_summary?.grossRev || 0), 0);
  const totalUnits = jobs.reduce((a,j) => a + (j.items||[]).reduce((b: number,it: any) => b + (it.buy_sheet_lines||[]).reduce((c: number,l: any) => c + (l.qty_ordered||0), 0), 0), 0);
  const activeJobs = jobs.filter(j => !["complete","cancelled"].includes(j.phase));

  // Financial summary across all projects
  const allPayments = jobs.flatMap(j => (j.payment_records || []).map((p: any) => ({ ...p, job_title: j.title })));
  const totalInvoiced = allPayments.reduce((a: number, p: any) => a + (p.amount || 0), 0);
  const totalPaid = allPayments.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + (p.amount || 0), 0);
  const totalOutstanding = allPayments.filter((p: any) => !["paid","void"].includes(p.status)).reduce((a: number, p: any) => a + (p.amount || 0), 0);
  const now = new Date();
  const overdue = allPayments.filter((p: any) => p.due_date && new Date(p.due_date) < now && !["paid","void"].includes(p.status));
  const totalOverdue = overdue.reduce((a: number, p: any) => a + (p.amount || 0), 0);

  return (
    <div style={{fontFamily:font,color:T.text,maxWidth:900,margin:"0 auto",paddingBottom:"3rem"}}>
      <button onClick={()=>router.push("/clients")} style={{background:"none",border:"none",color:T.muted,fontSize:12,cursor:"pointer",marginBottom:12,padding:0,fontFamily:font}}>
        ← All clients
      </button>

      {/* Header */}
      <div style={{marginBottom:16}}>
        <h1 style={{fontSize:24,fontWeight:700,margin:"0 0 6px",letterSpacing:"-0.02em"}}>{client.name}</h1>
        <div style={{display:"flex",gap:16,fontSize:12,color:T.muted}}>
          <span>{jobs.length} project{jobs.length!==1?"s":""}</span>
          <span>{activeJobs.length} active</span>
          <span>{totalUnits.toLocaleString()} total units</span>
        </div>
      </div>

      {/* Financial summary */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
        {[
          {label:"Total Revenue",value:totalRev>0?"$"+Math.round(totalRev).toLocaleString():"—",color:T.accent},
          {label:"Total Paid",value:totalPaid>0?"$"+Math.round(totalPaid).toLocaleString():"—",color:T.green},
          {label:"Outstanding",value:totalOutstanding>0?"$"+Math.round(totalOutstanding).toLocaleString():"$0",color:totalOutstanding>0?T.amber:T.faint},
          {label:"Overdue",value:totalOverdue>0?"$"+Math.round(totalOverdue).toLocaleString():"$0",color:totalOverdue>0?T.red:T.faint},
        ].map(s=>(
          <div key={s.label} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,padding:"10px 14px"}}>
            <div style={{fontSize:18,fontWeight:700,color:s.color,fontFamily:mono}}>{s.value}</div>
            <div style={{fontSize:10,color:T.muted,marginTop:2}}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,alignItems:"start"}}>
        {/* Left — Client info */}
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Client Info</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <div>
                <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Name</label>
                <input style={ic} value={client.name} onChange={e=>updateClient({name:e.target.value})}/>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div>
                  <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Type</label>
                  <select style={ic} value={client.client_type||""} onChange={e=>updateClient({client_type:e.target.value||null})}>
                    <option value="">—</option>
                    {["corporate","brand","artist","tour","webstore"].map(t=><option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Payment terms</label>
                  <select style={ic} value={client.default_terms||""} onChange={e=>updateClient({default_terms:e.target.value||null})}>
                    <option value="">—</option>
                    {["net_15","net_30","deposit_balance","prepaid"].map(t=><option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Notes</label>
                <textarea style={{...ic,minHeight:60,resize:"vertical",lineHeight:1.4}} value={client.notes||""} onChange={e=>updateClient({notes:e.target.value})}/>
              </div>
            </div>
          </div>

          {/* Contacts */}
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em"}}>Contacts</div>
              <button onClick={()=>setAddingContact(!addingContact)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:10,padding:"2px 8px",cursor:"pointer"}}>+ Add</button>
            </div>
            {addingContact&&(
              <div style={{background:T.surface,border:`1px solid ${T.accent}44`,borderRadius:8,padding:10,marginBottom:8}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
                  <input id="cc-name" placeholder="Name" style={ic}/>
                  <input id="cc-email" placeholder="Email" style={ic}/>
                  <input id="cc-phone" placeholder="Phone" style={ic}/>
                  <input id="cc-role" placeholder="Role (e.g. Manager)" style={ic}/>
                </div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={async()=>{
                    const name=(document.getElementById("cc-name") as HTMLInputElement).value.trim();
                    if(!name) return;
                    const email=(document.getElementById("cc-email") as HTMLInputElement).value.trim()||null;
                    const phone=(document.getElementById("cc-phone") as HTMLInputElement).value.trim()||null;
                    const role_label=(document.getElementById("cc-role") as HTMLInputElement).value.trim()||null;
                    await supabase.from("contacts").insert({name,email,phone,role_label,client_id:params.id});
                    setAddingContact(false);
                    load();
                  }} style={{background:T.green,border:"none",borderRadius:5,color:"#fff",fontSize:11,fontWeight:600,padding:"5px 12px",cursor:"pointer"}}>Save</button>
                  <button onClick={()=>setAddingContact(false)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:5,color:T.muted,fontSize:11,padding:"5px 10px",cursor:"pointer"}}>Cancel</button>
                </div>
              </div>
            )}
            {contacts.length===0&&!addingContact&&<p style={{fontSize:12,color:T.muted}}>No contacts yet.</p>}
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {contacts.map(c=>(
                <div key={c.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:T.surface,borderRadius:6}}>
                  <div style={{width:26,height:26,borderRadius:"50%",background:T.accentDim,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,color:T.accent,flexShrink:0}}>
                    {c.name.split(" ").map(n=>n[0]).join("").slice(0,2)}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:600}}>{c.name} {c.role_label&&<span style={{fontWeight:400,color:T.muted,fontSize:10}}>· {c.role_label}</span>}</div>
                    <div style={{fontSize:10,color:T.muted}}>{[c.email,c.phone].filter(Boolean).join(" · ")}</div>
                  </div>
                  <button onClick={()=>setConfirmRemove(c)} style={{background:"none",border:"none",color:T.faint,cursor:"pointer",fontSize:11}}
                    onMouseEnter={e=>e.currentTarget.style.color=T.red}
                    onMouseLeave={e=>e.currentTarget.style.color=T.faint}>✕</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — Job history */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
          <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Project History</div>
          {jobs.length===0&&<p style={{fontSize:12,color:T.muted}}>No projects yet.</p>}
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {jobs.map(j=>{
              const phase = PHASE_COLORS[j.phase]||PHASE_COLORS.intake;
              const rev = j.costing_summary?.grossRev || 0;
              const units = (j.items||[]).reduce((a: number,it: any) => a + (it.buy_sheet_lines||[]).reduce((b: number,l: any) => b + (l.qty_ordered||0), 0), 0);
              return(
                <Link key={j.id} href={`/jobs/${j.id}`} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:T.surface,borderRadius:6,textDecoration:"none",color:T.text,transition:"background 0.1s"}}
                  onMouseEnter={(e:any)=>e.currentTarget.style.background=T.accentDim}
                  onMouseLeave={(e:any)=>e.currentTarget.style.background=T.surface}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{j.title}</div>
                    <div style={{fontSize:10,color:T.muted,marginTop:1}}>{j.job_number} {units>0&&`· ${units.toLocaleString()} units`} {rev>0&&`· $${Math.round(rev).toLocaleString()}`}</div>
                  </div>
                  <span style={{padding:"2px 8px",borderRadius:99,fontSize:10,fontWeight:600,background:phase.bg,color:phase.text,whiteSpace:"nowrap",flexShrink:0}}>{j.phase.replace(/_/g," ")}</span>
                  {j.target_ship_date&&<span style={{fontSize:10,color:T.muted,fontFamily:mono,flexShrink:0}}>{new Date(j.target_ship_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove contact"
        message={confirmRemove ? `Remove ${confirmRemove.name} from this client?` : ""}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!confirmRemove) return;
          await supabase.from("contacts").delete().eq("id", confirmRemove.id);
          setConfirmRemove(null);
          load();
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}

"use client";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { T, font, mono } from "@/lib/theme";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SkeletonRows } from "@/components/Skeleton";
import Link from "next/link";
import { effectiveRevenue } from "@/lib/revenue";

type Client = { id:string; name:string; client_type:string|null; default_terms:string|null; notes:string|null; website:string|null; billing_address:string|null; shipping_address:string|null; tax_exempt:boolean; allow_cc?:boolean; allow_ach?:boolean; };
type Contact = { id:string; name:string; email:string|null; phone:string|null; role_label:string|null; is_primary:boolean; };
type Job = { id:string; title:string; job_number:string; phase:string; target_ship_date:string|null; costing_summary:any; items:any[]; payment_records:any[]; };

const PHASE_COLORS: Record<string,{bg:string,text:string}> = {
  intake:{bg:T.accentDim,text:T.accent}, pending:{bg:T.amberDim,text:"#a07008"},
  ready:{bg:T.amberDim,text:"#a07008"}, production:{bg:T.blueDim,text:"#3a8a9e"},
  receiving:{bg:T.blueDim,text:"#3a8a9e"}, fulfillment:{bg:T.purpleDim,text:"#c4207a"},
  complete:{bg:T.greenDim,text:T.green}, on_hold:{bg:T.redDim,text:T.red},
  cancelled:{bg:T.faint,text:T.muted},
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
  const [historyView, setHistoryView] = useState<"projects"|"items">("projects");
  const saveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  useEffect(() => { load(); }, [params.id]);

  async function load() {
    setLoading(true);
    const [cRes, ctRes, jRes] = await Promise.all([
      supabase.from("clients").select("*").eq("id", params.id).single(),
      supabase.from("contacts").select("*").eq("client_id", params.id).order("name"),
      supabase.from("jobs").select("*, costing_summary, type_meta, items(id, name, blank_vendor, blank_sku, cost_per_unit, sell_per_unit, blank_costs, sort_order, buy_sheet_lines(size, qty_ordered)), payment_records(amount, status, due_date)").eq("client_id", params.id).order("created_at", { ascending: false }),
    ]);
    if (cRes.data) setClient(cRes.data);
    if (ctRes.data) setContacts(ctRes.data as Contact[]);
    if (jRes.data) setJobs(jRes.data as Job[]);
    setLoading(false);
  }

  const pendingClientUpdates = useRef<Partial<Client>>({});
  function updateClient(updates: Partial<Client>) {
    setClient(c => c ? {...c, ...updates} : c);
    pendingClientUpdates.current = {...pendingClientUpdates.current, ...updates};
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const merged = pendingClientUpdates.current;
      pendingClientUpdates.current = {};
      try { await supabase.from("clients").update(merged).eq("id", params.id); }
      catch (e) { console.error("Client save failed:", e); }
    }, 1500);
  }

  if (loading) return (
    <div style={{padding:"2rem"}}>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
      <SkeletonRows rows={4} />
    </div>
  );
  if (!client) return <div style={{padding:"2rem",color:T.muted,fontSize:13}}>Client not found.</div>;

  const totalRev = jobs.reduce((a,j) => a + effectiveRevenue(j), 0);
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

  // Item history — flatten all items across all jobs
  const allItems = jobs.flatMap(j => (j.items || []).map((it: any) => ({
    ...it,
    jobId: j.id,
    jobTitle: j.title,
    jobNumber: (j as any).type_meta?.qb_invoice_number || j.job_number,
    jobDate: j.target_ship_date || j.created_at,
    totalQty: (it.buy_sheet_lines || []).reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0),
    sizes: (it.buy_sheet_lines || []).map((l: any) => l.size),
    qtys: Object.fromEntries((it.buy_sheet_lines || []).map((l: any) => [l.size, l.qty_ordered])),
  })));

  // Group by item identity (name + blank_vendor + blank_sku)
  const itemGroups: Record<string, any[]> = {};
  for (const it of allItems) {
    const key = `${it.name}||${it.blank_vendor || ""}||${it.blank_sku || ""}`;
    if (!itemGroups[key]) itemGroups[key] = [];
    itemGroups[key].push(it);
  }
  const sortedItemGroups = Object.entries(itemGroups).sort((a, b) => b[1].length - a[1].length);

  async function reorderItem(item: any) {
    // Create a new job with this item pre-filled
    const { data: newJob } = await supabase.from("jobs").insert({
      title: `${client!.name} — Reorder`,
      job_type: "corporate",
      phase: "intake",
      priority: "normal",
      shipping_route: "ship_through",
      payment_terms: client!.default_terms || null,
      client_id: client!.id,
      job_number: "",
    }).select("id").single();
    if (!newJob) return;

    // Create the item
    const { data: newItem } = await supabase.from("items").insert({
      job_id: newJob.id,
      name: item.name,
      blank_vendor: item.blank_vendor || null,
      blank_sku: item.blank_sku || null,
      cost_per_unit: item.cost_per_unit || null,
      blank_costs: item.blank_costs || null,
      status: "tbd",
      artwork_status: "not_started",
      sort_order: 0,
    }).select("id").single();

    // Copy sizes with zero qtys
    if (newItem && item.sizes?.length > 0) {
      await supabase.from("buy_sheet_lines").insert(
        item.sizes.map((sz: string) => ({ item_id: newItem.id, size: sz, qty_ordered: 0, qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0 }))
      );
    }

    // Add client contacts
    const { data: clientContacts } = await supabase.from("contacts").select("id, is_primary").eq("client_id", client!.id);
    if (clientContacts?.length) {
      await supabase.from("job_contacts").insert(
        clientContacts.map((c: any) => ({ job_id: newJob.id, contact_id: c.id, role_on_job: c.is_primary ? "primary" : "cc" }))
      );
    }

    router.push(`/jobs/${newJob.id}`);
  }

  return (
    <div style={{fontFamily:font,color:T.text,maxWidth:900,margin:"0 auto",paddingBottom:"3rem"}}>
      <button onClick={()=>router.push("/clients")} style={{background:"none",border:"none",color:T.muted,fontSize:12,cursor:"pointer",marginBottom:12,padding:0,fontFamily:font}}>
        ← All clients
      </button>

      {/* Header */}
      <div style={{marginBottom:16,display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:700,margin:"0 0 6px",letterSpacing:"-0.02em"}}>{client.name}</h1>
          <div style={{display:"flex",gap:16,fontSize:12,color:T.muted}}>
            <span>{jobs.length} project{jobs.length!==1?"s":""}</span>
            <span>{activeJobs.length} active</span>
            <span>{totalUnits.toLocaleString()} total units</span>
          </div>
        </div>
        <button onClick={async()=>{
          const jobCount = jobs.length;
          const msg = jobCount > 0
            ? `Delete "${client.name}" and all ${jobCount} project${jobCount!==1?"s":""}, items, contacts, and related data? This cannot be undone.`
            : `Delete "${client.name}" and all associated contacts? This cannot be undone.`;
          if(!window.confirm(msg)) return;
          // Cascade: delete job children first, then jobs, then client data
          const jobIds = jobs.map(j=>j.id);
          if(jobIds.length > 0){
            const itemIds = (jobs.flatMap((j:any)=>(j.items||[]).map((it:any)=>it.id))).filter(Boolean);
            if(itemIds.length > 0){
              await supabase.from("buy_sheet_lines").delete().in("item_id",itemIds);
              await supabase.from("item_files").delete().in("item_id",itemIds);
              await supabase.from("decorator_assignments").delete().in("item_id",itemIds);
              await supabase.from("items").delete().in("id",itemIds);
            }
            await supabase.from("job_contacts").delete().in("job_id",jobIds);
            await supabase.from("job_activity").delete().in("job_id",jobIds);
            await supabase.from("payment_records").delete().in("job_id",jobIds);
            await supabase.from("jobs").delete().in("id",jobIds);
          }
          await supabase.from("contacts").delete().eq("client_id",client.id);
          await supabase.from("clients").delete().eq("id",client.id);
          router.push("/clients");
        }}
          style={{background:"none",border:`1px solid ${T.border}`,borderRadius:6,color:T.faint,fontSize:11,padding:"6px 12px",cursor:"pointer",fontFamily:font}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.red;e.currentTarget.style.color=T.red;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.faint;}}>
          Delete Client
        </button>
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

      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {/* Client info */}
        {/* Client info + Contacts — single card, 2 columns */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,alignItems:"start"}}>
            {/* Left — Client info */}
            <div>
              <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:8}}>Client Info</div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div>
                  <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Name</label>
                  <input style={ic} value={client.name} onChange={e=>updateClient({name:e.target.value})}/>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Payment terms</label>
                    <select style={ic} value={client.default_terms||""} onChange={e=>updateClient({default_terms:e.target.value||null})}>
                      <option value="">—</option>
                      {["net_15","net_30","deposit_balance","prepaid"].map(t=><option key={t} value={t}>{t.replace(/_/g," ")}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Website</label>
                    <input style={ic} value={client.website||""} onChange={e=>updateClient({website:e.target.value||null})}/>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div>
                    <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Billing address</label>
                    <textarea style={{...ic,minHeight:90,resize:"vertical",lineHeight:1.4}} value={client.billing_address||""} onChange={e=>updateClient({billing_address:e.target.value||null})}/>
                  </div>
                  <div>
                    <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Shipping address</label>
                    <textarea style={{...ic,minHeight:90,resize:"vertical",lineHeight:1.4}} value={client.shipping_address||""} onChange={e=>updateClient({shipping_address:e.target.value||null})}/>
                  </div>
                </div>
                <label style={{display:"flex",alignItems:"center",gap:8,fontSize:13,fontWeight:600,color:T.text,cursor:"pointer",padding:"6px 10px",background:T.surface,borderRadius:6,width:"fit-content"}}>
                  <input type="checkbox" checked={client.tax_exempt||false} onChange={e=>updateClient({tax_exempt:e.target.checked} as any)} style={{accentColor:T.accent,width:18,height:18}}/>
                  Tax Exempt
                </label>

                {/* QB online payment-method toggles. Default true so
                    behavior matches today; flip off per client if e.g.
                    they should only see Bank Transfer on the QB payment
                    page. Pushed to QB on the next Update QB Invoice. */}
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:T.muted,textTransform:"uppercase",letterSpacing:"0.07em",marginTop:6,marginBottom:6}}>QB Online Payment Methods</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:T.text,cursor:"pointer",padding:"6px 10px",background:T.surface,borderRadius:6}}>
                      <input type="checkbox" checked={client.allow_cc !== false} onChange={e=>updateClient({allow_cc:e.target.checked} as any)} style={{accentColor:T.accent,width:16,height:16}}/>
                      <span style={{fontWeight:600}}>Accept credit card</span>
                      <span style={{fontSize:10,color:T.faint,marginLeft:"auto"}}>2.99% per txn</span>
                    </label>
                    <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:T.text,cursor:"pointer",padding:"6px 10px",background:T.surface,borderRadius:6}}>
                      <input type="checkbox" checked={client.allow_ach !== false} onChange={e=>updateClient({allow_ach:e.target.checked} as any)} style={{accentColor:T.accent,width:16,height:16}}/>
                      <span style={{fontWeight:600}}>Accept bank transfer (ACH)</span>
                      <span style={{fontSize:10,color:T.faint,marginLeft:"auto"}}>1%, max $20</span>
                    </label>
                  </div>
                  <div style={{fontSize:10,color:T.faint,marginTop:6,lineHeight:1.4}}>
                    Pushed to QB on the next Update QB Invoice. Existing invoices keep whatever was set when they were created until re-pushed.
                  </div>
                </div>
              </div>
            </div>

            {/* Right — Contacts + Notes */}
            <div>
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
              {/* Notes */}
              <div style={{marginTop:12}}>
                <label style={{fontSize:11,color:T.muted,marginBottom:3,display:"block"}}>Notes</label>
                <textarea style={{...ic,minHeight:80,resize:"vertical",lineHeight:1.4}} value={client.notes||""} onChange={e=>updateClient({notes:e.target.value})}/>
              </div>
            </div>
          </div>
        </div>

        {/* History */}
        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"12px 14px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
            <div style={{display:"flex",gap:2,background:T.surface,borderRadius:6,padding:2}}>
              {(["projects","items"] as const).map(v=>(
                <button key={v} onClick={()=>setHistoryView(v)}
                  style={{padding:"3px 10px",borderRadius:4,fontSize:10,fontWeight:600,border:"none",cursor:"pointer",
                    background:historyView===v?T.accent:"transparent",color:historyView===v?"#fff":T.muted}}>
                  {v==="projects"?"Projects":"Items"}
                </button>
              ))}
            </div>
            <span style={{fontSize:10,color:T.faint}}>{historyView==="projects"?`${jobs.length} projects`:`${allItems.length} items`}</span>
          </div>

          {historyView==="projects"&&(
            <>
              {jobs.length===0&&<p style={{fontSize:12,color:T.muted}}>No projects yet.</p>}
              <div style={{display:"flex",flexDirection:"column",gap:4}}>
                {jobs.map(j=>{
                  const phase = PHASE_COLORS[j.phase]||PHASE_COLORS.intake;
                  const rev = effectiveRevenue(j);
                  const units = (j.items||[]).reduce((a: number,it: any) => a + (it.buy_sheet_lines||[]).reduce((b: number,l: any) => b + (l.qty_ordered||0), 0), 0);
                  return(
                    <Link key={j.id} href={`/jobs/${j.id}`} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:T.surface,borderRadius:6,textDecoration:"none",color:T.text,transition:"background 0.1s"}}
                      onMouseEnter={(e:any)=>e.currentTarget.style.background=T.accentDim}
                      onMouseLeave={(e:any)=>e.currentTarget.style.background=T.surface}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{j.title}</div>
                        <div style={{fontSize:10,color:T.muted,marginTop:1}}>{(j as any).type_meta?.qb_invoice_number || j.job_number} {units>0&&`· ${units.toLocaleString()} units`} {rev>0&&`· $${Math.round(rev).toLocaleString()}`}</div>
                      </div>
                      <span style={{padding:"2px 8px",borderRadius:99,fontSize:10,fontWeight:600,background:phase.bg,color:phase.text,whiteSpace:"nowrap",flexShrink:0}}>{j.phase.replace(/_/g," ")}</span>
                      {j.target_ship_date&&<span style={{fontSize:10,color:T.muted,fontFamily:mono,flexShrink:0}}>{new Date(j.target_ship_date).toLocaleDateString("en-US",{month:"short",day:"numeric"})}</span>}
                    </Link>
                  );
                })}
              </div>
            </>
          )}

          {historyView==="items"&&(
            <>
              {sortedItemGroups.length===0&&<p style={{fontSize:12,color:T.muted}}>No items yet.</p>}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {sortedItemGroups.map(([key, instances])=>{
                  const first = instances[0];
                  const isRepeat = instances.length > 1;
                  return(
                    <div key={key} style={{background:T.surface,borderRadius:8,padding:"8px 10px",border:isRepeat?`1px solid ${T.accent}33`:`1px solid transparent`}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:isRepeat?6:0}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontSize:12,fontWeight:600}}>{first.name}</span>
                            {isRepeat&&<span style={{fontSize:9,fontWeight:600,padding:"1px 6px",borderRadius:99,background:T.accentDim,color:T.accent}}>{instances.length}x</span>}
                          </div>
                          <div style={{fontSize:10,color:T.muted,marginTop:1}}>{[first.blank_vendor,first.blank_sku].filter(Boolean).join(" · ")}</div>
                        </div>
                        <button onClick={()=>reorderItem(first)}
                          style={{fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:6,background:T.accent,color:"#fff",border:"none",cursor:"pointer"}}>
                          Reorder
                        </button>
                      </div>
                      {isRepeat&&(
                        <div style={{display:"flex",flexDirection:"column",gap:2,marginTop:4}}>
                          {instances.map((inst: any,i: number)=>(
                            <Link key={inst.id+i} href={`/jobs/${inst.jobId}`} style={{display:"flex",alignItems:"center",gap:8,fontSize:10,color:T.muted,textDecoration:"none",padding:"2px 0"}}
                              onMouseEnter={(e:any)=>e.currentTarget.style.color=T.accent}
                              onMouseLeave={(e:any)=>e.currentTarget.style.color=T.muted}>
                              <span style={{fontFamily:mono}}>{inst.jobNumber}</span>
                              <span>{inst.jobTitle}</span>
                              <span style={{fontFamily:mono}}>{inst.totalQty} units</span>
                              <span style={{marginLeft:"auto"}}>{new Date(inst.jobDate).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                      {!isRepeat&&(
                        <div style={{display:"flex",alignItems:"center",gap:8,fontSize:10,color:T.faint,marginTop:2}}>
                          <span style={{fontFamily:mono}}>{first.jobNumber}</span>
                          <span>{first.jobTitle}</span>
                          <span style={{fontFamily:mono}}>{first.totalQty} units</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
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

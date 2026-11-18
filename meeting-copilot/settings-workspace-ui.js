function SettingsWorkspace({ tabs, saveBar, alerts }) {
  const h = jsxRuntimeExports.jsx, hs = jsxRuntimeExports.jsxs;
  const [active, setActive] = reactExports.useState('models');
  const root = reactExports.useRef(null);
  reactExports.useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector('[role="tab"][aria-selected="true"]')?.focus();
    return () => previous?.focus?.();
  }, []);
  const choose = id => { setActive(id); root.current?.querySelector('.preferences-content')?.scrollTo(0, 0); };
  return hs('div', { className: 'settings preferences-workspace', role:'dialog', 'aria-modal':true, 'aria-label':'设置', ref:root,
    onKeyDown:e=>{
      if(e.key==='Escape'){e.preventDefault();saveBar.props.onClose();}
      if(e.key==='Tab'){
        const nodes=[...root.current.querySelectorAll('button,input,select,textarea,summary,[tabindex="0"]')].filter(n=>!n.disabled&&n.getClientRects().length);
        const first=nodes[0],last=nodes.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    }, children:[
    h('style',{children:SETTINGS_WORKSPACE_CSS}),
    h('header',{className:'preferences-header',children:saveBar}),
    hs('div',{className:'preferences-body',children:[
      hs('nav',{className:'preferences-nav','aria-label':'设置分类',children:[
        h('div',{className:'preferences-brand',children:'MEETINGCOPILOT'}),
        h('div',{role:'tablist','aria-orientation':'vertical',children:tabs.map((tab,index)=>hs('button',{
          type:'button',role:'tab',id:'preferences-tab-'+tab.id,'aria-controls':'preferences-panel-'+tab.id,'aria-selected':active===tab.id,tabIndex:active===tab.id?0:-1,
          onClick:()=>choose(tab.id),onKeyDown:e=>{if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowDown'?1:-1)+tabs.length)%tabs.length;choose(tabs[i].id);root.current.querySelector('#preferences-tab-'+tabs[i].id)?.focus();}},
          children:[h('span',{className:'preferences-number','aria-hidden':true,children:String(index+1).padStart(2,'0')}),h('span',{children:tab.title})]
        },tab.id))}),
        h('div',{className:'preferences-nav-note',children:'修改后自动保存'})
      ]}),
      hs('div',{className:'preferences-content',children:[alerts,...tabs.map(tab=>hs('section',{
        id:'preferences-panel-'+tab.id,role:'tabpanel','aria-labelledby':'preferences-tab-'+tab.id,hidden:active!==tab.id,
        children:[hs('div',{className:'preferences-heading',children:[h('h2',{children:tab.title}),h('p',{children:tab.description})]}),...tab.content]
      },tab.id))]})
    ]})
  ]});
}
function SettingsCard({ title, children, description }) {
 const h=jsxRuntimeExports.jsx,hs=jsxRuntimeExports.jsxs;
 return hs('section',{className:'preferences-card',children:[title&&h('h3',{children:title}),description&&h('p',{className:'preferences-caption',children:description}),children]});
}
const SETTINGS_WORKSPACE_CSS = `
html:has(.preferences-workspace){opacity:1!important}
.preferences-workspace.settings{position:fixed!important;inset:0!important;z-index:1000!important;display:flex!important;flex-direction:column!important;width:auto!important;max-width:none!important;height:auto!important;max-height:none!important;margin:0!important;padding:0!important;overflow:hidden!important;border:0!important;border-radius:0!important;background:#111722!important;color:#e8edf7!important;font:13px/1.5 'Segoe UI','Microsoft YaHei',sans-serif;--panel:#111722;--popup-bg:#182130;--popup-border:#344158;--input-bg:#101722;--app-border:#303c50;color-scheme:dark}
.preferences-workspace *{box-sizing:border-box}
.preferences-header{flex:none;border-bottom:1px solid #2b3545;background:#151d2a}
.preferences-header>div{position:static!important;background:transparent!important;padding:18px 24px!important;margin:0!important;min-height:68px;gap:16px!important}
.preferences-header strong{font-size:20px;letter-spacing:.04em}
.preferences-header [role=status]{font-size:12px;color:#91a4bf}
.preferences-body{flex:1;min-height:0;display:grid;grid-template-columns:176px minmax(0,1fr)}
.preferences-nav{display:flex;flex-direction:column;padding:24px 12px 16px;border-right:1px solid #2b3545;background:#151d2a;overflow:auto}
.preferences-brand{font-size:10px;color:#6e819e;letter-spacing:.12em;padding:0 12px 20px}
.preferences-nav [role=tablist]{display:grid;gap:6px}
.preferences-nav [role=tab]{display:flex;align-items:center;gap:10px;padding:12px;border:1px solid transparent;border-radius:8px;background:transparent;color:#9daec5;cursor:pointer;text-align:left;font:inherit;white-space:nowrap}
.preferences-nav [role=tab]:hover{background:#202c3e;color:#fff}
.preferences-nav [role=tab][aria-selected=true]{background:#233b5c;border-color:#375b89;color:#dceaff}
.preferences-number{font-size:10px;color:#7189a8;font-variant-numeric:tabular-nums}
.preferences-nav-note{margin-top:auto;padding:28px 12px 0;font-size:11px;color:#6e819e}
.preferences-content{overflow:auto;min-width:0;padding:26px 30px 40px;scrollbar-width:thin;scrollbar-color:#44546e transparent}
.preferences-content>[hidden]{display:none!important}
.preferences-heading{margin-bottom:22px}.preferences-heading h2{font-size:23px;font-weight:600;letter-spacing:.02em;margin:0 0 5px}.preferences-heading p{margin:0;color:#8395ae;font-size:12px}
.preferences-card{max-width:900px;margin:0 0 18px;padding:20px 22px;background:#182130;border:1px solid #2c384c;border-radius:12px}
.preferences-card h3{font-size:14px;font-weight:600;color:#e3ecf9;margin:0 0 16px}.preferences-caption{color:#8d9fb9;font-size:12px;margin:-6px 0 16px}
.preferences-workspace .settings-row{display:grid!important;grid-template-columns:142px minmax(0,1fr);gap:8px 16px!important;align-items:center;margin:12px 0!important}
.preferences-workspace .settings-row>label{width:auto!important;min-width:0!important;margin:0!important;color:#a6b6cc;font-size:12px}
.preferences-workspace .settings-row>.settings-inline-hint{grid-column:2}
.preferences-workspace .settings-row>.key-test-result{grid-column:2}
.preferences-workspace input:not([type=checkbox]):not([type=range]),.preferences-workspace select,.preferences-workspace textarea{width:100%;min-width:0!important;max-width:100%;padding:9px 11px!important;border:1px solid #354258!important;border-radius:7px!important;background:#101722!important;color:#e5ecf8!important;font:inherit;outline:none}
.preferences-workspace input:focus,.preferences-workspace select:focus,.preferences-workspace textarea:focus{border-color:#608ed0!important;box-shadow:0 0 0 2px #608ed022}
.preferences-workspace input[type=checkbox]{accent-color:#6e9ee5;width:16px;height:16px;justify-self:start}
.preferences-workspace input[type=range]{accent-color:#6e9ee5;min-width:60px;max-width:100%}
.preferences-workspace textarea{line-height:1.7;resize:vertical}
.preferences-workspace .btn{border:1px solid #3a4962!important;border-radius:7px!important;background:#253249!important;color:#dfe9fa!important;padding:7px 12px!important;min-height:32px;font-size:12px;cursor:pointer;white-space:normal}
.preferences-workspace .btn:hover{background:#304567!important}.preferences-workspace .btn-primary{background:#3367b5!important;border-color:#477fce!important}.preferences-workspace .btn:disabled{opacity:.45;cursor:default}
.preferences-workspace :focus-visible{outline:2px solid #8cbbff;outline-offset:2px}
.preferences-workspace .settings-hint,.preferences-workspace .settings-inline-hint{font-size:11px;color:#8395ae;margin:8px 0;line-height:1.65}
.preferences-workspace .settings-warn,.preferences-workspace .answer-error{padding:10px 12px;border:1px solid #865b45;border-radius:7px;background:#3c2c23;color:#ffcb9c;overflow-wrap:anywhere}
.preferences-workspace .settings-section{font-size:14px;color:#dce8f9;margin:0 0 16px!important}
.preferences-workspace .settings-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.preferences-workspace details{margin:12px 0}.preferences-workspace summary{cursor:pointer;padding:8px 0;color:#b7c9e3;font-weight:500}
.preferences-workspace .window-controls-settings{font-size:13px!important}.preferences-workspace .window-controls-settings>summary{display:none}
.preferences-workspace .window-controls-settings label{display:grid!important;grid-template-columns:142px minmax(0,1fr);gap:16px!important;margin:12px 0!important;align-items:center}
.preferences-workspace .window-controls-settings label>span{width:auto!important;color:#a6b6cc}
.preferences-workspace .window-controls-settings label:has(input[type=range]),.preferences-workspace .window-controls-settings label:has(input[type=number]){grid-template-columns:142px minmax(60px,1fr) auto}
.preferences-workspace .vision-endpoints>[id^=vision-api-]{background:#111a28;border:1px solid #354258!important;border-radius:10px!important;padding:16px!important}
.preferences-workspace .vision-endpoints>[id^=vision-api-]>div:first-child{margin-bottom:12px}
.preferences-workspace pre{font-size:11px;overflow-wrap:anywhere;background:#101722;padding:12px;border-radius:8px;max-width:100%}
.preferences-workspace .preferences-library>section,.preferences-workspace .preferences-prompt>section{border:0!important;padding:0!important;margin:0!important}
.preferences-library>section>strong,.preferences-prompt>section>label:first-child{display:none!important}
.preferences-library label{display:flex;align-items:center;gap:8px;margin:10px 0}.preferences-library input,.preferences-library select{margin:6px 0}.preferences-library .btn{margin:6px 6px 6px 0}.preferences-library p{font-size:12px;color:#8d9fb9}
@media(max-width:680px){.preferences-body{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}.preferences-nav{padding:8px;border-right:0;border-bottom:1px solid #2b3545}.preferences-brand,.preferences-nav-note,.preferences-number{display:none}.preferences-nav [role=tablist]{display:flex;overflow:auto;gap:4px}.preferences-nav [role=tab]{padding:9px;flex-shrink:0}.preferences-content{padding:18px 14px}.preferences-card{padding:16px}.preferences-heading h2{font-size:20px}.preferences-workspace .settings-row,.preferences-workspace .window-controls-settings label{grid-template-columns:1fr!important;gap:6px!important}.preferences-workspace .settings-row>.settings-inline-hint,.preferences-workspace .settings-row>.key-test-result{grid-column:1}.preferences-header>div{padding:12px 16px!important;min-height:54px}}
`;

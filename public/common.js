/* ============================================================
 *  Brulée · utilitats compartides entre pàgines (vanilla JS)
 *  Exposa window.Brulee amb helpers, estils i components comuns.
 * ============================================================ */
(function () {
  "use strict";

  var MESOS_CA = ['Gener','Febrer','Març','Abril','Maig','Juny','Juliol','Agost','Setembre','Octubre','Novembre','Desembre'];
  var MESOS_CURT = ['gen','feb','març','abr','maig','juny','jul','ago','set','oct','nov','des'];
  var ESTAT_LABEL = { pendent:'Pendent', pagada:'Pagada', vencuda:'Vençuda', revisio_manual:'Revisió manual', cancel_lada:'Cancel·lada', esborrany:'Esborrany' };
  var TIPUS_LABEL = { factura:'Factura', albara:'Albarà', tiquet:'Tiquet', desconegut:'Desconegut' };

  var ICONS = {
    panel: 'M3.5 3.5h7v7h-7zM13.5 3.5h7v7h-7zM3.5 13.5h7v7h-7zM13.5 13.5h7v7h-7z',
    recibidas: 'M17 7 L7 17 M15 17H7V9',
    emitidas: 'M7 17 L17 7 M9 7h8v8',
    proveedores: 'M12 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4 21c1-4.2 4.2-6 8-6s7 1.8 8 6',
    drive: 'M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z',
    importar: 'M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5M4.5 20h15',
    revisio: 'M4.5 13.5h4l1.5 3h4l1.5-3h4M4.5 13.5 7 5h10l2.5 8.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18z',
    config: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19'
  };

  function fmt(n) { return (Number(n) || 0).toLocaleString('ca-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function css(o) { var s=''; for (var k in o){ var p=k.replace(/[A-Z]/g,function(m){return '-'+m.toLowerCase();}); s+=p+':'+o[k]+';'; } return s; }
  function fmtDataCurta(iso) { if(!iso) return ''; var p=String(iso).split('-'); if(p.length<3) return String(iso); return parseInt(p[2],10)+' '+MESOS_CURT[parseInt(p[1],10)-1]; }
  function fmtDataLlarga(iso) { if(!iso) return '—'; var p=String(iso).split('-'); if(p.length<3) return String(iso); return parseInt(p[2],10)+' '+MESOS_CURT[parseInt(p[1],10)-1]+' '+p[0]; }
  function diesFins(iso) { if(!iso) return null; var a=new Date(); a.setHours(0,0,0,0); var d=new Date(iso+'T00:00:00'); if(isNaN(d.getTime())) return null; return Math.round((d-a)/86400000); }
  function inicials(nom) { return String(nom||'?').split(/\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase() || '?'; }

  function api(path, opts) {
    return fetch(path, opts).then(function (r) {
      if (!r.ok) return r.json().catch(function(){return {};}).then(function(j){ throw new Error(j.error || ('Error HTTP '+r.status)); });
      return r.json();
    });
  }

  function badge(estatKey) {
    var label = ESTAT_LABEL[estatKey] || estatKey;
    var base = { display:'inline-flex', alignItems:'center', gap:'6px', padding:'4px 10px', borderRadius:'4px', fontSize:'10.5px', fontWeight:700, letterSpacing:'.06em', textTransform:'uppercase', whiteSpace:'nowrap' };
    function ext(o){ for(var k in o) base[k]=o[k]; return base; }
    if (estatKey==='pagada') return { s: ext({ color:'#9DBF8E', border:'1px solid rgba(157,191,142,.35)', background:'rgba(157,191,142,.08)' }), label:label };
    if (estatKey==='pendent') return { s: ext({ color:'#F5B800', border:'1px solid rgba(245,184,0,.4)', background:'rgba(245,184,0,.08)' }), label:label };
    if (estatKey==='vencuda') return { s: ext({ color:'#D97B66', border:'1px solid rgba(217,123,102,.4)', background:'rgba(217,123,102,.09)' }), label:label };
    if (estatKey==='revisio_manual') return { s: ext({ color:'#7FA8C9', border:'1px solid rgba(127,168,201,.38)', background:'rgba(127,168,201,.08)' }), label:label };
    if (estatKey==='cancel_lada') return { s: ext({ color:'#D97B66', border:'1px solid rgba(217,123,102,.3)', background:'transparent' }), label:label };
    return { s: ext({ color:'#8A867D', border:'1px dashed rgba(242,240,233,.25)', background:'transparent' }), label:label };
  }
  function confChip(c) {
    return { display:'inline-block', padding:'3px 8px', borderRadius:'4px', fontSize:'11px', fontWeight:700,
      color: c>=90?'#9DBF8E':c>=60?'#F5B800':'#D97B66',
      background: c>=90?'rgba(157,191,142,.09)':c>=60?'rgba(245,184,0,.09)':'rgba(217,123,102,.1)' };
  }
  var tipoChip = { display:'inline-block', padding:'3px 9px', borderRadius:'4px', fontSize:'10.5px', fontWeight:600, letterSpacing:'.04em', color:'#B9B4A6', border:'1px solid rgba(242,240,233,.14)', whiteSpace:'nowrap' };
  function dueStyle(r) {
    if (r.estat==='vencuda' || (r.dueDays!==null && r.dueDays<0 && r.estat!=='pagada' && r.estat!=='cancel_lada')) return { fontSize:'12.5px', fontWeight:700, color:'#D97B66' };
    if (r.dueDays!==null && r.dueDays<=7 && r.estat==='pendent') return { fontSize:'12.5px', fontWeight:700, color:'#F5B800' };
    return { fontSize:'12.5px', color:'#B9B4A6' };
  }

  // ---- Sidebar compartida ---------------------------------------------
  function sidebarHTML(active) {
    var navBase = 'display:flex;align-items:center;gap:11px;width:100%;padding:9px 12px;border:none;border-radius:6px;background:transparent;color:#B9B4A6;font-size:13px;font-weight:600;letter-spacing:.04em;text-align:left;text-decoration:none;transition:all .15s';
    var navActive = 'display:flex;align-items:center;gap:11px;width:100%;padding:9px 12px;border:none;border-radius:6px;background:#F5B800;color:#080808;font-size:13px;font-weight:600;letter-spacing:.04em;text-align:left;text-decoration:none';
    function item(id, label, icon, href, active2, badgeId) {
      var tag = href ? 'a' : 'button';
      var attrs = href ? ('href="'+href+'"') : ('type="button"' + (id?(' data-side="'+id+'"'):''));
      var badgeHTML = badgeId
        ? '<span id="'+badgeId+'" style="margin-left:auto;display:none;min-width:19px;padding:1px 6px;border-radius:9px;background:#D97B66;color:#080808;font-size:10px;font-weight:700;line-height:16px;text-align:center">0</span>'
        : '';
      return '<'+tag+' '+attrs+' style="'+(active2?navActive:navBase)+'">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex:none"><path d="'+ICONS[icon]+'"></path></svg>' +
        '<span>'+esc(label)+'</span>' + badgeHTML + '</'+tag+'>';
    }
    function group(label, items) {
      return '<div style="display:flex;flex-direction:column;gap:3px">' +
        '<div style="padding:0 12px 5px;font-size:9.5px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:#5d5a52">'+esc(label)+'</div>' +
        items.join('') + '</div>';
    }
    // El comptador es pinta just despres que la pagina injecti aquest HTML.
    setTimeout(refrescarBadgePendents, 0);

    return '<aside style="position:sticky;top:0;height:100vh;overflow-y:auto;display:flex;flex-direction:column;gap:22px;padding:22px 14px 18px;border-right:1px solid rgba(242,240,233,.09);background:#0a0a0a">' +
      '<div style="display:flex;flex-direction:column;gap:4px;padding:2px 8px 0">' +
        '<div style="display:flex;align-items:center;gap:7px">' +
          '<span style="font-family:\'Rubik Spray Paint\',cursive;font-size:22px;color:#F5B800;line-height:1;letter-spacing:.01em;text-shadow:2px 2px 0 rgba(0,0,0,.8)">BRULÈE</span>' +
          '<span style="font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:13px;color:#F2F0E9;transform:translateY(-3px)">2.0</span>' +
        '</div>' +
        '<span style="font-size:10px;font-weight:600;letter-spacing:.24em;text-transform:uppercase;color:#8A867D">Facturació</span>' +
      '</div>' +
      '<nav style="display:flex;flex-direction:column;gap:18px">' +
        group('Principal', [
          item(null, 'Panell', 'panel', '/', active==='panell'),
          item(null, 'Safata de revisió', 'revisio', '/revisio.html', active==='revisio', 'sideBadgePendents'),
          item(null, 'Factures rebudes', 'recibidas', '/rebudes.html', active==='rebudes'),
          item(null, 'Factures emeses', 'emitidas', '/emeses.html', active==='emeses')
        ]) +
        group('Sistema', [ item(null, 'Configuració', 'config', null, false) ]) +
      '</nav>' +
      '<div style="margin-top:auto;display:flex;align-items:center;gap:10px;padding:12px 10px;border:1px solid rgba(242,240,233,.09);border-radius:8px;background:#0f0f0f">' +
        '<div style="width:30px;height:30px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:6px;background:#F5B800;color:#080808;font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:15px;transform:rotate(-2deg)">B</div>' +
        '<div style="display:flex;flex-direction:column;gap:1px;min-width:0">' +
          '<span style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Brulée Artesana</span>' +
          '<span style="font-size:10.5px;color:#8A867D">Mario Trepos</span>' +
        '</div>' +
      '</div>' +
    '</aside>';
  }

  /** Rellegeix la safata i actualitza el comptador vermell del menú lateral. */
  function refrescarBadgePendents() {
    var el = document.getElementById('sideBadgePendents');
    if (!el) return;
    api('/api/pendents')
      .then(function (res) {
        var n = (res && res.total) || 0;
        el.textContent = n > 99 ? '99+' : n;
        el.style.display = n > 0 ? 'inline-block' : 'none';
      })
      .catch(function () { el.style.display = 'none'; });
  }

  /** Trimestre en català a partir del número de mes (1–12). */
  function getTrimestre(mes) {
    if (mes <= 3) return '1r Trimestre';
    if (mes <= 6) return '2n Trimestre';
    if (mes <= 9) return '3r Trimestre';
    return '4t Trimestre';
  }

  // ---- Files de la taula (mateix layout de 8 columnes que el panell) ---
  function tableRowsHTML(rows, opts) {
    opts = opts || {};
    if (!rows.length) {
      return '<div style="padding:26px 22px;font-size:13px;color:#8A867D">'+esc(opts.emptyMsg||'Sense resultats.')+'</div>';
    }
    return rows.map(function (r, i) {
      var b = badge(r.estat);
      return '<div class="row-hover" style="display:grid;grid-template-columns:minmax(190px,1.5fr) 92px 100px 86px 104px 104px 128px 40px;gap:10px;align-items:center;padding:11px 22px;border-bottom:1px solid rgba(242,240,233,.055)">' +
        '<div style="display:flex;align-items:center;gap:10px;min-width:0">' +
          '<span style="flex:none;width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:rgba(245,184,0,.12);color:#F5B800;font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:12px;letter-spacing:.04em">'+esc(inicials(r.client))+'</span>' +
          '<div style="display:flex;flex-direction:column;gap:1px;min-width:0">' +
            '<span style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(r.client)+'</span>' +
            '<span style="font-size:10.5px;color:#8A867D">#'+esc(r.num)+'</span>' +
          '</div>' +
        '</div>' +
        '<span><span style="'+css(tipoChip)+'">'+esc(r.tipo)+'</span></span>' +
        '<span><span style="'+css(confChip(r.conf))+'">'+r.conf+'%</span></span>' +
        '<span style="font-size:12.5px;color:#B9B4A6">'+esc(r.issued||'—')+'</span>' +
        '<span style="'+css(dueStyle(r))+'">'+esc(r.due||'—')+'</span>' +
        '<span style="text-align:right;font-family:\'Barlow Condensed\',sans-serif;font-weight:600;font-size:15.5px">'+fmt(r.amount)+'</span>' +
        '<span style="display:flex;justify-content:flex-end"><span style="'+css(b.s)+'">'+esc(b.label)+'</span></span>' +
        '<button class="icon-btn" data-view="'+i+'" aria-label="Veure detall" style="width:30px;height:30px;display:flex;align-items:center;justify-content:center;border:none;border-radius:6px;background:transparent;color:#8A867D">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"></path><circle cx="12" cy="12" r="2.6"></circle></svg>' +
        '</button>' +
      '</div>';
    }).join('');
  }

  function pagerHTML(page, pages) {
    var pageBase = { minWidth:'32px', padding:'7px 10px', border:'1px solid rgba(242,240,233,.13)', borderRadius:'5px', background:'transparent', color:'#8A867D', fontSize:'12px', fontWeight:600 };
    var html = '';
    for (var i=1;i<=pages;i++){
      var st = i===page ? Object.assign({},pageBase,{background:'#F5B800',borderColor:'#F5B800',color:'#080808'}) : pageBase;
      html += '<button data-page="'+i+'" style="'+css(st)+'">'+i+'</button>';
    }
    if (page<pages) html += '<button data-page="'+(page+1)+'" style="'+css(pageBase)+'">→</button>';
    return html;
  }

  function detailHTML(r, opts) {
    opts = opts || {};
    var b = badge(r.estat);
    var fields = opts.fields || [];
    return '<div id="detailOverlay" style="position:fixed;inset:0;z-index:40;background:rgba(0,0,0,.62);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px">' +
      '<div id="detailBox" style="width:420px;max-width:100%;background:#0f0f0f;border:1px solid rgba(242,240,233,.14);border-radius:10px;padding:24px;display:flex;flex-direction:column;gap:0;box-shadow:0 30px 70px rgba(0,0,0,.6)">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
          '<div style="display:flex;flex-direction:column;gap:2px">' +
            '<span style="font-family:\'Barlow Condensed\',sans-serif;font-weight:600;font-size:19px;letter-spacing:.08em;text-transform:uppercase">'+esc(r.client)+'</span>' +
            '<span style="font-size:11px;color:#8A867D">#'+esc(r.num)+' · '+esc(r.tipo)+'</span>' +
          '</div>' +
          '<span style="'+css(b.s)+'">'+esc(b.label)+'</span>' +
        '</div>' +
        fields.map(function (f) {
          return '<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;border-bottom:1px solid rgba(242,240,233,.07)">' +
            '<span style="font-size:10.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#8A867D">'+esc(f.k)+'</span>' +
            '<span style="font-size:13px;font-weight:600">'+esc(f.v)+'</span></div>';
        }).join('') +
        '<div style="display:flex;gap:8px;margin-top:18px">' +
          (opts.payBtn ? '<button id="detailPay" style="flex:1;padding:12px;border:none;border-radius:4px 9px 5px 10px;background:#F5B800;color:#080808;font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:14px;letter-spacing:.1em;text-transform:uppercase">'+esc(opts.payBtn)+'</button>' : '') +
          (opts.downloadBtn ? '<button id="detailDownload" style="flex:1;padding:12px;border:1px solid rgba(245,184,0,.5);border-radius:5px;background:transparent;color:#F5B800;font-family:\'Barlow Condensed\',sans-serif;font-weight:700;font-size:14px;letter-spacing:.1em;text-transform:uppercase">Descarregar PDF</button>' : '') +
          '<button id="detailClose" style="flex:1;padding:12px;border:1px solid rgba(242,240,233,.16);border-radius:5px;background:transparent;color:#B9B4A6;font-family:\'Barlow Condensed\',sans-serif;font-weight:600;font-size:14px;letter-spacing:.1em;text-transform:uppercase">Tancar</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function omplirMesos(sel) {
    var now = new Date();
    for (var i=0;i<12;i++){
      var d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      var val = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');
      var opt = document.createElement('option');
      opt.value = val; opt.textContent = MESOS_CA[d.getMonth()]+' '+d.getFullYear();
      sel.appendChild(opt);
    }
  }

  window.Brulee = {
    MESOS_CA: MESOS_CA, MESOS_CURT: MESOS_CURT, ESTAT_LABEL: ESTAT_LABEL, TIPUS_LABEL: TIPUS_LABEL, ICONS: ICONS,
    fmt: fmt, esc: esc, css: css, fmtDataCurta: fmtDataCurta, fmtDataLlarga: fmtDataLlarga, diesFins: diesFins, inicials: inicials, api: api,
    badge: badge, confChip: confChip, tipoChip: tipoChip, dueStyle: dueStyle,
    sidebarHTML: sidebarHTML, refrescarBadgePendents: refrescarBadgePendents, getTrimestre: getTrimestre, tableRowsHTML: tableRowsHTML, pagerHTML: pagerHTML, detailHTML: detailHTML, omplirMesos: omplirMesos
  };
})();

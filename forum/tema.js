    /* =================================================================
   TEMİZ URL KURTARMA — GitHub Pages / statik sunucu uyumlu
   404.html üzerinden buraya yönlendirilen istekleri, adres
   çubuğunda orijinal temiz URL'e geri çevirir (sayfa yeniden
   yüklenmeden). Böylece /forum/1/genel/baslik.html gibi linkler
   sunucu ayarından bağımsız olarak HER ZAMAN çalışır.
   =================================================================== */
(function restoreCleanUrl(){
    try{
        var params=new URLSearchParams(window.location.search);
        var redirected=params.get('__redirect');
        if(redirected!==null){
            params.delete('__redirect');
            var qs=params.toString();
            var newPath='/forum/'+redirected.replace(/^\/+/,'');
            var newUrl=newPath+(qs?('?'+qs):'')+window.location.hash;
            window.history.replaceState(null,'',newUrl);
        }
    }catch(e){ console.warn('[v0] URL kurtarma hatası',e); }
})();

/* ===================================================================
       DMOZ Q&A - UYGULAMA MANTIĞI
       =================================================================== */

    // ---- YAPILANDIRMA ----
    const SITE_ORIGIN = 'https://dmozz.eu.cc';
    const SUPABASE_URL = 'https://qfilqgbtubvafcnpwtqj.supabase.co';
    // ÖNEMLİ: Aşağıya kendi Supabase "anon public" anahtarınızı yapıştırın.
    const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFmaWxxZ2J0dWJ2YWZjbnB3dHFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI4MjI4NDMsImV4cCI6MjA5ODM5ODg0M30.F72EjHi1Sr3bJy_tiXpJl3MD5RZqbLPhblvhzzvUDIY';
    const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // Durum
    let currentUser = null;     // auth user
    let profile = null;         // profiles satırı
    let categoriesCache = [];
    let activeChatUser = null;  // mesajlaşılan profil

    /* ---------------- YARDIMCILAR ---------------- */
    function slugify(text){
        const map={ç:'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u','Ç':'c','Ğ':'g','İ':'i','Ö':'o','Ş':'s','Ü':'u'};
        return (text||'').toString().toLowerCase().replace(/[çğıöşüÇĞİÖŞÜ]/g,m=>map[m]||m).trim()
            .replace(/\s+/g,'-').replace(/[^\w-]+/g,'').replace(/--+/g,'-');
    }
    function escapeHtml(s){ const d=document.createElement('div'); d.textContent=s||''; return d.innerHTML; }
    function timeAgo(date){
        const s=Math.floor((new Date()-new Date(date))/1000);
        let i=s/31536000; if(i>1)return Math.floor(i)+" yıl önce";
        i=s/2592000; if(i>1)return Math.floor(i)+" ay önce";
        i=s/86400; if(i>1)return Math.floor(i)+" gün önce";
        i=s/3600; if(i>1)return Math.floor(i)+" saat önce";
        i=s/60; if(i>1)return Math.floor(i)+" dk önce";
        return "az önce";
    }
    function isOnline(lastSeen){ return lastSeen && (new Date()-new Date(lastSeen)) < 120000; }
    function showToast(title,message,icon='check_circle',isError=false){
        const t=document.getElementById('toast'),ic=document.getElementById('toastIcon');
        document.getElementById('toastTitle').innerText=title;
        document.getElementById('toastMessage').innerText=message||'';
        ic.innerText=icon;
        ic.classList.toggle('text-error',isError); ic.classList.toggle('text-primary-fixed',!isError);
        t.classList.remove('translate-y-32','opacity-0');
        clearTimeout(t._tm); t._tm=setTimeout(()=>t.classList.add('translate-y-32','opacity-0'),4000);
    }
    function buildUrl(q){ return `/forum/?s=${q.id}/${q.category||'genel'}/${slugify(q.title)}.html`; }
    function buildCategoryUrl(slug){ return `/forum/?category=${encodeURIComponent(slug)}`; }
    function isStaff(){ return profile && (profile.role==='admin'||profile.role==='moderator'); }
    function isAdmin(){ return profile && profile.role==='admin'; }
    function verifiedBadge(p){ return p && p.verified ? `<span class="material-symbols-outlined verified-tick text-base align-middle" title="Onaylı üye" style="font-variation-settings:'FILL' 1">verified</span>` : ''; }

    /* ---------------- GÜVENLİK: BOT / SPAM / FLOOD (client-side önlem) ----------------
       ÖNEMLİ: Bunlar gerçek sunucu taraflı korumanın (Supabase RLS + rate limit,
       Edge Function tabanlı doğrulama, CAPTCHA vb.) yerini TUTMAZ. Statik bir
       sitede yapılabilecek en iyi ilk savunma katmanıdır: bot tuzağı (honeypot)
       ve istemci taraflı "flood" (art arda gönderim) sınırlaması. */
    function honeypotTripped(id){
        const el=document.getElementById(id);
        return !!(el && el.value && el.value.trim().length>0);
    }
    const _floodTimestamps={};
    function floodBlocked(key,minIntervalMs=4000){
        const now=Date.now();
        const last=_floodTimestamps[key]||0;
        if(now-last<minIntervalMs) return true;
        _floodTimestamps[key]=now;
        return false;
    }
    /* Zengin metin (editör) içeriğini DOM'a basmadan önce temizler.
       DOMPurify CDN'den yüklenemezse (ör. ağ engeli) güvenli tarafta kalıp
       düz metne indirger — asla ham HTML'i olduğu gibi basmaz. */
    let _purifyHooked=false;
    function sanitizeRich(html){
        if(!window.DOMPurify) return escapeHtml(html);
        if(!_purifyHooked){
            // Sadece YouTube embed iframe'lerine izin ver; başka her iframe kaldırılır
            DOMPurify.addHook('uponSanitizeElement',(node,data)=>{
                if(data.tagName==='iframe'){
                    const src=node.getAttribute('src')||'';
                    if(!/^https:\/\/www\.youtube\.com\/embed\//.test(src)) node.remove();
                }
            });
            _purifyHooked=true;
        }
        return DOMPurify.sanitize(html||'',{
            ALLOWED_TAGS:['b','strong','i','em','u','a','p','br','ul','ol','li','blockquote','img','video','source','h1','h2','h3','span','iframe'],
            ALLOWED_ATTR:['href','src','alt','title','target','rel','class','controls','frameborder','allowfullscreen','width','height','style'],
            ADD_TAGS:['iframe']
        });
    }

    /* ---------------- MODAL / DRAWER ---------------- */
    function toggleModal(id,show){
        const m=document.getElementById(id);
        m.classList.toggle('hidden',!show); m.classList.toggle('flex',show);
        document.body.style.overflow=show?'hidden':'';
    }
    function openDrawer(id){
        document.getElementById('drawerOverlay').classList.remove('hidden');
        document.getElementById(id).classList.remove('translate-x-full');
    }
    function closeDrawers(){
        document.getElementById('drawerOverlay').classList.add('hidden');
        ['notifDrawer','msgDrawer','adminDrawer'].forEach(id=>document.getElementById(id).classList.add('translate-x-full'));
    }

    /* ---------------- BAŞLATMA ---------------- */
    async function init(){
        if(SUPABASE_KEY==='YOUR_SUPABASE_ANON_KEY'){
            showToast('Kurulum Gerekli','Lütfen kod içindeki SUPABASE_KEY değerini girin.','key',true);
        }
        await loadSession();
        await loadCategories();
        setupEventListeners();
        loadSidebarData();
        setupRealtime();
        route();
        setInterval(heartbeat, 60000);
        const header=document.getElementById('topHeader');
        window.addEventListener('scroll',()=>{ header.classList.toggle('scrolled',window.scrollY>8); },{passive:true});
    }

    function route(){
        const params=new URLSearchParams(window.location.search);
        const cat=params.get('category');
        const profileUser=params.get('u');
        // Temiz URL: /forum/{id}/{kategori}/{baslik}.html
        const path=window.location.pathname.replace(/^\/forum\/?/,'').replace(/\/$/,'');
        const match=path.match(/^(\d+)\/[^\/]+\/[^\/]+\.html$/);
        // Temiz kategori URL'i: /forum/kategori/{slug}.html
        const catMatch=path.match(/^kategori\/([^\/]+)\.html$/);
        // Eski biçimle geriye dönük uyumluluk: /forum/?s=12/genel/baslik.html
        const s=params.get('s');
        if(match){ renderQuestionDetail(match[1]); }
        else if(s){ renderQuestionDetail(s.split('/')[0]); }
        else if(catMatch){ renderCategory(decodeURIComponent(catMatch[1])); }
        else if(profileUser){ renderUserProfile(profileUser); }
        else if(cat){ renderCategory(cat); } // eski ?category= linkleri için geriye dönük uyumluluk
        else { renderHome(); }
    }

    /* ---------------- OTURUM / PROFİL ---------------- */
    async function loadSession(){
        const { data:{ session } } = await supabaseClient.auth.getSession();
        currentUser = session?.user || null;
        if(currentUser){
            const { data } = await supabaseClient.from('profiles').select('*').eq('id',currentUser.id).single();
            profile = data;
            if(profile?.banned){
                showToast('Hesap Engellendi','Hesabınız yönetici tarafından engellenmiştir.','block',true);
                await supabaseClient.auth.signOut(); profile=null; currentUser=null;
            } else { heartbeat(); }
        }
        renderUserArea();
    }

    async function heartbeat(){
        if(profile) await supabaseClient.from('profiles').update({ last_seen:new Date().toISOString() }).eq('id',profile.id);
    }

    function renderUserArea(){
        const area=document.getElementById('userProfileArea');
        const msgBtn=document.getElementById('messagesBtn');
        const adminBtn=document.getElementById('adminBtn');
        if(profile){
            msgBtn.classList.remove('hidden');
            adminBtn.classList.toggle('hidden',!isStaff());
            area.innerHTML=`
                <button class="flex items-center gap-2 group shrink-0" id="profileMenuBtn">
                    <span class="w-9 h-9 sm:w-10 sm:h-10 rounded-full border-2 border-primary-container shadow-sm group-hover:scale-105 transition-transform overflow-hidden shrink-0 block bg-surface-container">
                        <img src="${profile.avatar_url}" class="w-full h-full object-cover" alt="Profil"/>
                    </span>
                </button>`;
            document.getElementById('profileMenuBtn').addEventListener('click',()=>{ window.location.href='/forum/?u='+encodeURIComponent(profile.username); });
            loadUnreadCounts();
        } else {
            msgBtn.classList.add('hidden'); adminBtn.classList.add('hidden');
            area.innerHTML=`<button class="bg-primary-container text-on-primary-container flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full font-label-md text-label-md shadow hover:bg-primary transition-all active:scale-95 shrink-0 whitespace-nowrap" id="loginBtn"><span class="material-symbols-outlined text-lg">login</span><span class="hidden sm:inline">Giriş Yap</span></button>`;
            document.getElementById('loginBtn').addEventListener('click',()=>toggleModal('authModal',true));
        }
    }

    function requireAuth(){
        if(!profile){ toggleModal('authModal',true); showToast('Giriş Gerekli','Bu işlem için üye girişi yapın.','lock',true); return false; }
        return true;
    }

    /* ---------------- KATEGORİLER ---------------- */
    async function loadCategories(){
        const { data } = await supabaseClient.from('categories').select('*').order('name');
        categoriesCache = data || [];
        // Sidebar
        const list=document.getElementById('categoryList');
        list.innerHTML = categoriesCache.map(c=>`
            <li class="group flex items-center justify-between p-2 rounded-lg hover:bg-white transition-all cursor-pointer" onclick="window.location.href='${buildCategoryUrl(c.slug)}'">
                <span class="font-body-md text-on-surface-variant group-hover:text-primary transition-colors">${escapeHtml(c.name)}</span>
                <span class="material-symbols-outlined text-sm text-outline group-hover:text-primary">chevron_right</span>
            </li>`).join('');
        // Modal select
        const sel=document.getElementById('qCategory');
        sel.innerHTML = categoriesCache.map(c=>`<option value="${c.slug}">${escapeHtml(c.name)}</option>`).join('');
    }

    /* ---------------- ANASAYFA / LİSTE ---------------- */
    function renderHome(){
        document.getElementById('breadcrumbCurrent').innerText='Anasayfa';
        document.getElementById('listTitle').innerText='Son Sorular';
        injectHomeSchema();
        loadLatestQuestions();
    }
    function renderCategory(slug){
        const c=categoriesCache.find(x=>x.slug===slug);
        const name=c?c.name:slug;
        document.getElementById('breadcrumbCurrent').innerText=name;
        document.getElementById('listTitle').innerText=name+' Soruları';
        document.title=`${name} Soruları | DMOZ Q&A`;
        setMeta('canonicalLink','href',SITE_ORIGIN+buildCategoryUrl(slug));
        setMeta('ogUrl','content',SITE_ORIGIN+buildCategoryUrl(slug));
        setMeta('ogTitle','content',`${name} Soruları | DMOZ Q&A`);
        const catDesc=`${name} kategorisindeki tüm soru ve cevaplar. DMOZ Q&A topluluğuyla ${name.toLowerCase()} hakkında soru sor, cevap ver.`;
        let meta=document.querySelector('meta[name="description"]'); if(meta) meta.setAttribute('content',catDesc);
        setMeta('ogDesc','content',catDesc); setMeta('twDesc','content',catDesc); setMeta('twTitle','content',`${name} Soruları | DMOZ Q&A`);
        document.getElementById('json-ld-schema').textContent=JSON.stringify([
            {
                "@context":"https://schema.org","@type":"CollectionPage","name":name+' Soruları',
                "url":SITE_ORIGIN+buildCategoryUrl(slug),"description":catDesc,"inLanguage":"tr-TR",
                "isPartOf":{ "@type":"WebSite","name":"DMOZ Q&A","url":SITE_ORIGIN+'/forum/' }
            },
            {
                "@context":"https://schema.org","@type":"BreadcrumbList",
                "itemListElement":[
                    { "@type":"ListItem","position":1,"name":"Anasayfa","item":SITE_ORIGIN+"/forum/" },
                    { "@type":"ListItem","position":2,"name":name,"item":SITE_ORIGIN+buildCategoryUrl(slug) }
                ]
            }
        ]);
        loadLatestQuestions('created_at',slug);
    }

    /* Görüntülenen soru listesinden ItemList şeması üretir (anasayfa/kategori).
       Mevcut json-ld-schema içeriğine EKLENİR (üzerine yazmaz). */
    function injectListSchema(questions,pageUrl){
        if(!questions||!questions.length) return;
        const itemList={
            "@context":"https://schema.org","@type":"ItemList",
            "itemListElement":questions.slice(0,20).map((q,i)=>({
                "@type":"ListItem","position":i+1,"url":SITE_ORIGIN+buildUrl(q),"name":q.title
            }))
        };
        const el=document.getElementById('json-ld-schema');
        try{
            const existing=JSON.parse(el.textContent||'[]');
            const arr=Array.isArray(existing)?existing:[existing];
            arr.push(itemList);
            el.textContent=JSON.stringify(arr);
        }catch(e){ el.textContent=JSON.stringify(itemList); }
    }

    async function loadLatestQuestions(sort='created_at',category=null){
        const container=document.getElementById('questionsContainer');
        try{
            let query=supabaseClient.from('questions').select('*').order(sort==='popular'?'votes':'created_at',{ascending:false}).limit(20);
            if(category) query=query.eq('category',category);
            const { data,error }=await query;
            if(error) throw error;
            if(!data.length){ container.innerHTML=`<div class="text-center p-12 text-on-surface-variant">Henüz soru bulunmuyor.</div>`; return; }
            let profMap={};
            const ids=[...new Set(data.map(q=>q.author_id).filter(Boolean))];
            if(ids.length){ const { data:profs }=await supabaseClient.from('profiles').select('id,verified').in('id',ids); (profs||[]).forEach(p=>profMap[p.id]=p); }
            container.innerHTML=data.map(q=>renderQuestionCard(q,profMap[q.author_id])).join('');
            injectListSchema(data,window.location.href);
        }catch(err){ console.error('[v0] list error',err); container.innerHTML=`<div class="text-error p-4 text-center">Veriler yüklenirken hata oluştu.</div>`; }
    }

    function renderQuestionCard(q,authorP){
        const url=buildUrl(q);
        const tags=q.tags?q.tags.split(',').map(t=>`<span class="bg-primary/5 text-primary px-2 py-0.5 rounded text-[10px] font-bold border border-primary/20">#${escapeHtml(t.trim())}</span>`).join(' '):'';
        return `
            <article class="bg-surface-container-lowest border border-outline-variant rounded-xl p-5 hover:shadow-md hover:border-primary/30 transition-all group" onclick="window.location.href='${url}'">
                <div class="flex gap-4">
                    <div class="hidden sm:flex flex-col items-center justify-center bg-surface-container-low rounded-lg p-2 min-w-[60px] h-fit border border-outline-variant/20">
                        <span class="font-headline-md text-primary-container font-bold">${q.votes||0}</span>
                        <span class="text-[10px] text-on-surface-variant uppercase font-bold">BEĞENİ</span>
                    </div>
                    <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2 mb-2 text-xs">
                            <span class="font-bold text-primary">@${escapeHtml(q.author||'anonim')}</span>${verifiedBadge(authorP)}
                            <span class="text-outline">• ${timeAgo(q.created_at)}</span>
                        </div>
                        <h4 class="font-headline-md text-on-surface mb-2 group-hover:text-primary transition-colors line-clamp-1">${escapeHtml(q.title)}</h4>
                        <div class="text-on-surface-variant text-sm line-clamp-2 mb-4 leading-relaxed">${stripHtml(q.content)}</div>
                        <div class="flex flex-wrap items-center gap-2">
                            ${tags}
                            <div class="ml-auto flex items-center gap-4 text-outline text-[11px] font-bold">
                                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">forum</span> ${q.answer_count||0}</span>
                                <span class="flex items-center gap-1"><span class="material-symbols-outlined text-sm">visibility</span> ${q.views||0}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </article>`;
    }
    function stripHtml(html){ const d=document.createElement('div'); d.innerHTML=html||''; return escapeHtml(d.textContent.slice(0,200)); }

    /* ---------------- SORU DETAY ---------------- */
    async function renderQuestionDetail(idOrSlug){
        const id=parseInt(String(idOrSlug).split('/')[0]); // hem "12" hem "12/genel/baslik.html" formatını kabul eder
        try{
            const { data:q,error }=await supabaseClient.from('questions').select('*').eq('id',id).single();
            if(error||!q) throw error||new Error('not found');
            const [authorRes,answersRes]=await Promise.all([
                q.author_id?supabaseClient.from('profiles').select('username,avatar_url,verified,created_at,city,zodiac,profession').eq('id',q.author_id).maybeSingle():Promise.resolve({data:null}),
                supabaseClient.from('answers').select('content,author,created_at,votes').eq('question_id',q.id).order('votes',{ascending:false}).limit(50)
            ]);
            const authorP=authorRes.data;
            const answersForSchema=answersRes.data;
            injectSchema(q,answersForSchema);
            document.getElementById('breadcrumbCurrent').innerText=q.title.slice(0,40);
            const liked = profile ? await hasLiked(q.id) : false;
            const c=document.getElementById('viewContainer');
            c.innerHTML=`
                <div class="space-y-6">
                    <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 md:p-8 shadow-sm">
                        <div class="flex items-center gap-4 mb-6">
                            <a href="/forum/?u=${encodeURIComponent(q.author||'')}" class="w-14 h-14 rounded-full bg-primary-container flex items-center justify-center text-on-primary overflow-hidden shrink-0 border-2 border-primary-container/50 shadow-sm">
                                ${authorP?.avatar_url?`<img src="${escapeHtml(authorP.avatar_url)}" class="w-full h-full object-cover" alt="@${escapeHtml(q.author||'')}" loading="lazy" decoding="async"/>`:`<span class="material-symbols-outlined text-2xl">person</span>`}
                            </a>
                            <div class="flex-1 min-w-0">
                                <a href="/forum/?u=${encodeURIComponent(q.author||'')}" class="font-bold text-sm flex items-center gap-1 hover:text-primary transition-colors w-fit">@${escapeHtml(q.author||'anonim')} ${verifiedBadge(authorP)}</a>
                                <div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-on-surface-variant">
                                    <span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">schedule</span>${timeAgo(q.created_at)}</span>
                                    ${authorP?.created_at?`<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">calendar_month</span>Üyelik: ${new Date(authorP.created_at).toLocaleDateString('tr-TR',{year:'numeric',month:'long'})}</span>`:''}
                                    ${authorP?.city?`<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">location_on</span>${escapeHtml(authorP.city)}</span>`:''}
                                    ${authorP?.profession?`<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">work</span>${escapeHtml(authorP.profession)}</span>`:''}
                                    ${authorP?.zodiac?`<span class="flex items-center gap-1"><span class="material-symbols-outlined text-xs">star</span>${escapeHtml(authorP.zodiac)}</span>`:''}
                                </div>
                            </div>
                            ${(isStaff()||(profile&&profile.id===q.author_id))?`<button onclick="deleteQuestion(${q.id})" class="text-error hover:bg-error/10 p-2 rounded-full shrink-0"><span class="material-symbols-outlined">delete</span></button>`:''}
                        </div>
                        <h2 class="font-headline-lg font-bold text-on-surface mb-4 leading-tight">${escapeHtml(q.title)}</h2>
                        ${q.image_url?`<img src="${escapeHtml(q.image_url)}" class="rounded-xl mb-4 w-full" alt="${escapeHtml(q.title)}"/>`:''}
                        <div class="qbody text-body-lg text-on-surface-variant mb-8 leading-relaxed">${sanitizeRich(q.content)}</div>
                        <div class="flex gap-2 mb-8 flex-wrap">${q.tags?q.tags.split(',').map(t=>`<span class="bg-surface-container px-3 py-1 rounded text-xs text-primary font-bold">#${escapeHtml(t.trim())}</span>`).join(''):''}</div>
                        <div class="border-t border-outline-variant pt-6 flex justify-between items-center">
                            <div class="flex items-center gap-2">
                                <button onclick="toggleLike(${q.id})" id="likeBtn" class="flex items-center gap-2 px-4 py-2 ${liked?'bg-primary text-white':'bg-surface-container'} rounded-full hover:bg-primary/10 transition-colors font-bold text-sm">
                                    <span class="material-symbols-outlined text-lg" style="font-variation-settings:'FILL' ${liked?1:0}">favorite</span> <span id="likeCount">${q.votes||0}</span>
                                </button>
                                <button onclick="shareQuestion('${buildUrl(q).replace(/'/g,'')}','${escapeHtml(q.title).replace(/'/g,'')}')" class="flex items-center gap-2 px-4 py-2 bg-surface-container rounded-full hover:bg-primary/10 transition-colors font-bold text-sm">
                                    <span class="material-symbols-outlined text-lg">share</span> Paylaş
                                </button>
                            </div>
                        </div>
                    </div>
                    <div class="flex items-center gap-3"><span class="w-1 h-6 bg-primary rounded-full"></span><h3 class="font-headline-md font-bold text-on-surface"><span id="answerCountLabel">${q.answer_count||0}</span> Cevap</h3></div>
                    <div id="answersContainer" class="space-y-4"></div>
                    <div class="bg-surface-container-high rounded-xl p-6">
                        <h4 class="font-bold mb-4 text-primary">Cevabınızı Paylaşın</h4>
                        <textarea id="answerInput" class="w-full bg-surface-container-lowest border border-outline-variant rounded-xl p-4 min-h-[120px] focus:ring-2 focus:ring-primary outline-none transition-all" placeholder="Çözüm önerinizi buraya yazın..."></textarea>
                        <div class="flex justify-end mt-4"><button onclick="postAnswer(${q.id})" class="bg-primary-container text-on-primary-container px-8 py-2.5 rounded-full font-bold hover:shadow-lg transition-all active:scale-95">Cevapla</button></div>
                    </div>
                </div>`;
            loadAnswers(q.id);
            supabaseClient.rpc('increment_view_count',{q_id:q.id}).then(({error})=>{ if(error) supabaseClient.from('questions').update({views:(q.views||0)+1}).eq('id',q.id); });
        }catch(err){ console.error('[v0] detail error',err); renderHome(); showToast('Hata','Soru detayları yüklenemedi.','error',true); }
    }

    async function loadAnswers(qid){
        const c=document.getElementById('answersContainer');
        const { data }=await supabaseClient.from('answers').select('*').eq('question_id',qid).order('votes',{ascending:false});
        let profMap={};
        if(data&&data.length){
            const ids=[...new Set(data.map(a=>a.author_id).filter(Boolean))];
            if(ids.length){
                const { data:profs }=await supabaseClient.from('profiles').select('id,avatar_url,verified').in('id',ids);
                (profs||[]).forEach(p=>profMap[p.id]=p);
            }
        }
        c.innerHTML=(data&&data.length)?data.map(a=>{
            const ap=profMap[a.author_id];
            return `
            <div class="bg-white border border-outline-variant rounded-xl p-6 hover:shadow-sm transition-all">
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-8 h-8 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary overflow-hidden shrink-0">${ap?.avatar_url?`<img src="${escapeHtml(ap.avatar_url)}" class="w-full h-full object-cover" alt="" loading="lazy" decoding="async"/>`:`<span class="material-symbols-outlined text-sm">person</span>`}</div>
                    <div class="flex-1"><span class="font-bold text-xs flex items-center gap-1">@${escapeHtml(a.author||'anonim')} ${verifiedBadge(ap)}</span><span class="text-outline text-[10px] block">${timeAgo(a.created_at)}</span></div>
                    ${(isStaff()||(profile&&profile.id===a.author_id))?`<button onclick="deleteAnswer(${a.id},${qid})" class="text-error/60 p-1"><span class="material-symbols-outlined text-sm">delete</span></button>`:''}
                </div>
                <p class="text-on-surface-variant text-sm leading-relaxed whitespace-pre-wrap">${escapeHtml(a.content)}</p>
            </div>`;
        }).join('') : `<p class="text-on-surface-variant/60 text-center py-4 italic">Henüz cevap verilmemiş. İlk cevabı siz verin!</p>`;
    }

    async function postAnswer(qid){
        if(!requireAuth()) return;
        const input=document.getElementById('answerInput');
        const content=input.value.trim();
        if(!content){ showToast('Uyarı','Lütfen bir cevap yazın.','warning',true); return; }
        try{
            const { error }=await supabaseClient.from('answers').insert([{ question_id:qid, content, author:profile.username, author_id:profile.id, votes:0 }]);
            if(error) throw error;
            input.value='';
            showToast('Teşekkürler','Cevabınız kaydedildi.');
            loadAnswers(qid);
            supabaseClient.rpc('increment_answer_count',{q_id:qid});
            // soru sahibine bildirim
            const { data:q }=await supabaseClient.from('questions').select('author_id,title,category').eq('id',qid).single();
            if(q&&q.author_id&&q.author_id!==profile.id){
                await supabaseClient.from('notifications').insert([{ user_id:q.author_id, type:'answer', content:`@${profile.username} sorunuza cevap verdi: ${q.title.slice(0,40)}`, link:buildUrl({id:qid,category:q.category,title:q.title}) }]);
            }
            const lbl=document.getElementById('answerCountLabel'); if(lbl) lbl.innerText=parseInt(lbl.innerText||'0')+1;
        }catch(err){ console.error('[v0] answer error',err); showToast('Hata','Cevap gönderilemedi.','error',true); }
    }

    /* ---------------- BEĞENİ / PAYLAŞ ---------------- */
    async function hasLiked(qid){
        const { data }=await supabaseClient.from('likes').select('id').eq('user_id',profile.id).eq('question_id',qid).maybeSingle();
        return !!data;
    }
    async function toggleLike(qid){
        if(!requireAuth()) return;
        const liked=await hasLiked(qid);
        const btn=document.getElementById('likeBtn'), cnt=document.getElementById('likeCount');
        let n=parseInt(cnt.innerText||'0');
        if(liked){
            await supabaseClient.from('likes').delete().eq('user_id',profile.id).eq('question_id',qid);
            n=Math.max(0,n-1); btn.classList.remove('bg-primary','text-white'); btn.classList.add('bg-surface-container');
            btn.querySelector('.material-symbols-outlined').style.fontVariationSettings="'FILL' 0";
        } else {
            await supabaseClient.from('likes').insert([{ user_id:profile.id, question_id:qid }]);
            n=n+1; btn.classList.add('bg-primary','text-white'); btn.classList.remove('bg-surface-container');
            btn.querySelector('.material-symbols-outlined').style.fontVariationSettings="'FILL' 1";
            const { data:q }=await supabaseClient.from('questions').select('author_id,title,category').eq('id',qid).single();
            if(q&&q.author_id&&q.author_id!==profile.id){
                await supabaseClient.from('notifications').insert([{ user_id:q.author_id, type:'like', content:`@${profile.username} sorunuzu beğendi`, link:buildUrl({id:qid,category:q.category,title:q.title}) }]);
            }
        }
        cnt.innerText=n;
        await supabaseClient.from('questions').update({ votes:n }).eq('id',qid);
    }
    function shareQuestion(url,title){
        const full=window.location.origin+url;
        if(navigator.share){ navigator.share({ title, url:full }).catch(()=>{}); }
        else { navigator.clipboard.writeText(full); showToast('Kopyalandı','Bağlantı panoya kopyalandı.','link'); }
    }

    /* ---------------- KULLANICI PROFİLİ ---------------- */
    async function renderUserProfile(username){
        const { data:p }=await supabaseClient.from('profiles').select('*').eq('username',username).single();
        if(!p){ renderHome(); return; }
        document.getElementById('breadcrumbCurrent').innerText='@'+p.username;
        document.title=`@${p.username} | DMOZ Q&A`;
        const profUrl=SITE_ORIGIN+'/forum/?u='+encodeURIComponent(p.username);
        const profDesc=(p.bio?stripHtml(p.bio).slice(0,155):`${p.full_name||p.username} adlı üyenin DMOZ Q&A profili — sorular, cevaplar ve topluluk katkıları.`);
        setMeta('canonicalLink','href',profUrl);
        setMeta('ogUrl','content',profUrl);
        setMeta('ogTitle','content',`@${p.username} | DMOZ Q&A`);
        setMeta('ogDesc','content',profDesc); setMeta('twDesc','content',profDesc); setMeta('twTitle','content',`@${p.username} | DMOZ Q&A`);
        let pmeta=document.querySelector('meta[name="description"]'); if(pmeta) pmeta.setAttribute('content',profDesc);
        if(p.avatar_url){ setMeta('ogImage','content',p.avatar_url); setMeta('twImage','content',p.avatar_url); }
        const sameAs=[p.social_twitter,p.social_instagram,p.social_website].filter(Boolean);
        document.getElementById('json-ld-schema').textContent=JSON.stringify([
            {
                "@context":"https://schema.org","@type":"ProfilePage","url":profUrl,"inLanguage":"tr-TR",
                "mainEntity":{
                    "@type":"Person","name":p.full_name||p.username,"alternateName":p.username,
                    "image":p.avatar_url,"url":profUrl,"description":profDesc,
                    ...(p.profession?{"jobTitle":p.profession}:{}),
                    ...(p.city?{"address":{"@type":"PostalAddress","addressLocality":p.city}}:{}),
                    ...(sameAs.length?{"sameAs":sameAs}:{})
                }
            },
            {
                "@context":"https://schema.org","@type":"BreadcrumbList",
                "itemListElement":[
                    { "@type":"ListItem","position":1,"name":"Anasayfa","item":SITE_ORIGIN+"/forum/" },
                    { "@type":"ListItem","position":2,"name":"@"+p.username,"item":profUrl }
                ]
            }
        ]);
        const [{ data:questions },{ data:answers }]=await Promise.all([
            supabaseClient.from('questions').select('*').eq('author_id',p.id).order('created_at',{ascending:false}),
            supabaseClient.from('answers').select('*,questions(title,id,category)').eq('author_id',p.id).order('created_at',{ascending:false})
        ]);
        const online=isOnline(p.last_seen);
        const isMe=profile&&profile.id===p.id;
        const social=[
            p.social_twitter?`<a href="${escapeHtml(p.social_twitter)}" target="_blank" rel="noopener" class="text-secondary hover:underline flex items-center gap-1"><span class="material-symbols-outlined text-base">alternate_email</span>Twitter</a>`:'',
            p.social_instagram?`<a href="${escapeHtml(p.social_instagram)}" target="_blank" rel="noopener" class="text-secondary hover:underline flex items-center gap-1"><span class="material-symbols-outlined text-base">photo_camera</span>Instagram</a>`:'',
            p.social_website?`<a href="${escapeHtml(p.social_website)}" target="_blank" rel="noopener" class="text-secondary hover:underline flex items-center gap-1"><span class="material-symbols-outlined text-base">language</span>Web</a>`:''
        ].filter(Boolean).join('');
        document.getElementById('viewContainer').innerHTML=`
            <div class="bg-surface-container-lowest border border-outline-variant rounded-2xl p-6 md:p-8 shadow-sm">
                <div class="flex flex-col sm:flex-row items-center sm:items-start gap-6">
                    <div class="relative">
                        <img src="${p.avatar_url}" class="w-28 h-28 rounded-full object-cover border-4 border-primary-container" alt="@${escapeHtml(p.username)}"/>
                        <span class="absolute bottom-2 right-2 w-5 h-5 rounded-full border-2 border-white ${online?'online-dot':'offline-dot'}" title="${online?'Çevrimiçi':'Çevrimdışı'}"></span>
                    </div>
                    <div class="flex-1 text-center sm:text-left">
                        <div class="flex items-center justify-center sm:justify-start gap-2 mb-1">
                            <h2 class="font-headline-lg font-bold text-on-surface">${escapeHtml(p.full_name||p.username)}</h2>
                            ${verifiedBadge(p)}
                            ${p.role!=='user'?`<span class="text-[10px] bg-error/10 text-error px-2 py-0.5 rounded-full font-bold uppercase">${p.role}</span>`:''}
                        </div>
                        <p class="text-secondary font-bold mb-2">@${escapeHtml(p.username)} <span class="text-outline text-xs font-normal">• ${online?'<span class="text-green-600">çevrimiçi</span>':'son görülme '+timeAgo(p.last_seen)}</span></p>
                        ${p.bio?`<p class="text-on-surface-variant mb-3">${escapeHtml(p.bio)}</p>`:''}
                        <div class="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-1 text-sm text-on-surface-variant mb-3">
                            ${p.city?`<span class="flex items-center gap-1"><span class="material-symbols-outlined text-base">location_on</span>${escapeHtml(p.city)}</span>`:''}
                            ${p.profession?`<span class="flex items-center gap-1"><span class="material-symbols-outlined text-base">work</span>${escapeHtml(p.profession)}</span>`:''}
                            ${p.zodiac?`<span class="flex items-center gap-1"><span class="material-symbols-outlined text-base">star</span>${escapeHtml(p.zodiac)}</span>`:''}
                        </div>
                        <div class="flex flex-wrap items-center justify-center sm:justify-start gap-4 text-sm mb-4">${social}</div>
                        <div class="flex items-center justify-center sm:justify-start gap-3">
                            ${isMe?`<button onclick="openEditProfile()" class="bg-primary-container text-on-primary-container px-5 py-2 rounded-full font-bold text-sm flex items-center gap-1"><span class="material-symbols-outlined text-base">edit</span>Profili Düzenle</button>
                                    <button onclick="doSignOut()" class="bg-surface-container px-5 py-2 rounded-full font-bold text-sm text-error flex items-center gap-1"><span class="material-symbols-outlined text-base">logout</span>Çıkış</button>`
                                  :(profile?`<button onclick="openChatWith('${p.id}','${escapeHtml(p.username)}','${p.avatar_url}')" class="bg-primary-container text-on-primary-container px-5 py-2 rounded-full font-bold text-sm flex items-center gap-1"><span class="material-symbols-outlined text-base">chat</span>Mesaj Gönder</button>`:'')}
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-outline-variant">
                    <div class="text-center p-3 bg-surface-container-low rounded-xl"><p class="font-headline-lg font-bold text-primary">${questions?.length||0}</p><p class="text-xs text-on-surface-variant uppercase font-bold">Soru</p></div>
                    <div class="text-center p-3 bg-surface-container-low rounded-xl"><p class="font-headline-lg font-bold text-primary">${answers?.length||0}</p><p class="text-xs text-on-surface-variant uppercase font-bold">Cevap</p></div>
                </div>
            </div>
            <div class="mt-6">
                <h3 class="font-headline-md font-bold text-on-surface mb-3 flex items-center gap-2"><span class="material-symbols-outlined text-primary">help</span>Açtığı Sorular</h3>
                <div class="space-y-3">${questions&&questions.length?questions.map(renderQuestionCard).join(''):'<p class="text-on-surface-variant/60 italic text-sm">Henüz soru açılmamış.</p>'}</div>
            </div>
            <div class="mt-6">
                <h3 class="font-headline-md font-bold text-on-surface mb-3 flex items-center gap-2"><span class="material-symbols-outlined text-primary">question_answer</span>Verdiği Cevaplar</h3>
                <div class="space-y-2">${answers&&answers.length?answers.map(a=>`
                    <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 hover:border-primary/30 cursor-pointer" onclick="window.location.href='${a.questions?.id?buildUrl({id:a.questions.id,category:a.questions.category,title:a.questions.title||''}):'/forum/'}'">
                        <p class="text-xs text-secondary font-bold mb-1">${escapeHtml(a.questions?.title||'Soru')}</p>
                        <p class="text-sm text-on-surface-variant line-clamp-2">${escapeHtml(a.content)}</p>
                    </div>`).join(''):'<p class="text-on-surface-variant/60 italic text-sm">Henüz cevap verilmemiş.</p>'}</div>
            </div>`;
    }

    function openEditProfile(){
        if(!profile) return;
        document.getElementById('editAvatarPreview').src=profile.avatar_url;
        document.getElementById('epFullName').value=profile.full_name||'';
        document.getElementById('epCity').value=profile.city||'';
        document.getElementById('epZodiac').value=profile.zodiac||'';
        document.getElementById('epProfession').value=profile.profession||'';
        document.getElementById('epBio').value=profile.bio||'';
        document.getElementById('epTwitter').value=profile.social_twitter||'';
        document.getElementById('epInstagram').value=profile.social_instagram||'';
        document.getElementById('epWebsite').value=profile.social_website||'';
        toggleModal('editProfileModal',true);
    }

    /* ---------------- AUTH İŞLEMLERİ ---------------- */
    async function doSignOut(){
        await supabaseClient.auth.signOut();
        profile=null; currentUser=null;
        showToast('Çıkış Yapıldı','Görüşmek üzere!','logout');
        setTimeout(()=>window.location.href='/forum/',800);
    }

    /* ---------------- BİLDİRİM / MESAJ SAYAÇLARI ---------------- */
    async function loadUnreadCounts(){
        if(!profile) return;
        const [{ count:nc },{ count:mc }]=await Promise.all([
            supabaseClient.from('notifications').select('*',{count:'exact',head:true}).eq('user_id',profile.id).eq('read',false),
            supabaseClient.from('messages').select('*',{count:'exact',head:true}).eq('receiver_id',profile.id).eq('read',false)
        ]);
        const nd=document.getElementById('notificationDot');
        nd.innerText=nc||0; nd.classList.toggle('hidden',!nc); nd.classList.toggle('flex',!!nc);
        document.getElementById('notifPulseDot')?.classList.toggle('hidden',!nc);
        document.getElementById('mobileNotifDot')?.classList.toggle('hidden',!nc);
        const mb=document.getElementById('messageBadge');
        mb.innerText=mc||0; mb.classList.toggle('hidden',!mc); mb.classList.toggle('flex',!!mc);
    }

    async function openNotifications(){
        if(!requireAuth()) return;
        openDrawer('notifDrawer');
        const list=document.getElementById('notifList');
        const { data }=await supabaseClient.from('notifications').select('*').eq('user_id',profile.id).order('created_at',{ascending:false}).limit(50);
        list.innerHTML=(data&&data.length)?data.map(n=>`
            <div class="p-3 rounded-xl border ${n.read?'bg-surface-container-lowest border-outline-variant/30':'bg-primary/5 border-primary/20'} flex gap-3">
                <span class="material-symbols-outlined text-primary">${n.type==='message'?'chat':n.type==='like'?'favorite':n.type==='answer'?'question_answer':'notifications'}</span>
                <div class="flex-1"><p class="text-sm text-on-surface">${escapeHtml(n.content)}</p><p class="text-[10px] text-outline mt-1">${timeAgo(n.created_at)}</p></div>
            </div>`).join('') : '<p class="text-center text-on-surface-variant/60 py-8 text-sm">Bildirim yok.</p>';
        await supabaseClient.from('notifications').update({read:true}).eq('user_id',profile.id).eq('read',false);
        loadUnreadCounts();
    }

    /* ---------------- MESAJLAŞMA ---------------- */
    async function openMessages(){
        if(!requireAuth()) return;
        openDrawer('msgDrawer');
        showConversationList();
    }
    async function showConversationList(){
        document.getElementById('msgThread').classList.add('hidden');
        document.getElementById('msgThread').classList.remove('flex');
        document.getElementById('msgConversations').classList.remove('hidden');
        document.getElementById('msgDrawerTitle').innerText='Mesajlar';
        activeChatUser=null;
        const list=document.getElementById('msgConversations');
        const { data:msgs }=await supabaseClient.from('messages').select('*').or(`sender_id.eq.${profile.id},receiver_id.eq.${profile.id}`).order('created_at',{ascending:false});
        const partners={};
        (msgs||[]).forEach(m=>{ const other=m.sender_id===profile.id?m.receiver_id:m.sender_id; if(!partners[other]) partners[other]={last:m,unread:0}; if(m.receiver_id===profile.id&&!m.read) partners[other].unread++; });
        const ids=Object.keys(partners);
        if(!ids.length){ list.innerHTML='<p class="text-center text-on-surface-variant/60 py-8 text-sm">Henüz mesajınız yok. Bir profilden mesaj gönderin.</p>'; return; }
        const { data:profs }=await supabaseClient.from('profiles').select('id,username,avatar_url,last_seen').in('id',ids);
        list.innerHTML=profs.map(p=>{
            const info=partners[p.id];
            return `<div class="flex items-center gap-3 p-4 border-b border-outline-variant/30 hover:bg-surface-container-low cursor-pointer" onclick="openChatWith('${p.id}','${escapeHtml(p.username)}','${p.avatar_url}')">
                <div class="relative"><img src="${p.avatar_url}" class="w-12 h-12 rounded-full object-cover" alt="" loading="lazy" decoding="async"/><span class="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${isOnline(p.last_seen)?'online-dot':'offline-dot'}"></span></div>
                <div class="flex-1 min-w-0"><p class="font-bold text-sm">@${escapeHtml(p.username)}</p><p class="text-xs text-on-surface-variant truncate">${escapeHtml(info.last.content)}</p></div>
                ${info.unread?`<span class="bg-primary text-white text-[10px] rounded-full min-w-[20px] h-5 px-1 flex items-center justify-center font-bold">${info.unread}</span>`:''}
            </div>`;
        }).join('');
    }
    async function openChatWith(userId,username,avatar){
        if(!requireAuth()) return;
        closeDrawers(); openDrawer('msgDrawer');
        activeChatUser={id:userId,username,avatar};
        document.getElementById('msgConversations').classList.add('hidden');
        document.getElementById('msgThread').classList.remove('hidden');
        document.getElementById('msgThread').classList.add('flex');
        document.getElementById('msgDrawerTitle').innerText='@'+username;
        await loadThread();
        await supabaseClient.from('messages').update({read:true}).eq('sender_id',userId).eq('receiver_id',profile.id).eq('read',false);
        loadUnreadCounts();
    }
    async function loadThread(){
        const body=document.getElementById('msgThreadBody');
        const { data }=await supabaseClient.from('messages').select('*')
            .or(`and(sender_id.eq.${profile.id},receiver_id.eq.${activeChatUser.id}),and(sender_id.eq.${activeChatUser.id},receiver_id.eq.${profile.id})`)
            .order('created_at',{ascending:true});
        body.innerHTML=(data||[]).map(m=>{
            const mine=m.sender_id===profile.id;
            return `<div class="flex ${mine?'justify-end':'justify-start'}"><div class="${mine?'bg-primary-container text-on-primary-container':'bg-surface-container'} px-4 py-2 rounded-2xl max-w-[75%]"><p class="text-sm">${escapeHtml(m.content)}</p><p class="text-[9px] opacity-60 mt-1 text-right">${timeAgo(m.created_at)}</p></div></div>`;
        }).join('');
        body.scrollTop=body.scrollHeight;
    }

    /* ---------------- ADMIN ---------------- */
    async function openAdmin(){
        if(!isStaff()){ showToast('Yetkisiz','Bu alana erişiminiz yok.','block',true); return; }
        openDrawer('adminDrawer');
        loadAdminUsers();
    }
    async function loadAdminUsers(){
        const { data }=await supabaseClient.from('profiles').select('*').order('created_at',{ascending:false});
        document.getElementById('adminUsers').innerHTML=(data||[]).map(u=>`
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 flex items-center gap-3">
                <img src="${u.avatar_url}" class="w-10 h-10 rounded-full object-cover" alt="" loading="lazy" decoding="async"/>
                <div class="flex-1 min-w-0"><p class="font-bold text-sm flex items-center gap-1">@${escapeHtml(u.username)} ${verifiedBadge(u)}</p><p class="text-[10px] text-outline">${escapeHtml(u.email||'')} • ${u.role}${u.banned?' • <span class="text-error font-bold">YASAKLI</span>':''}</p></div>
                ${isAdmin()?`<select onchange="setRole('${u.id}',this.value)" class="text-xs border border-outline-variant rounded px-1 py-1 bg-white">
                    <option value="user" ${u.role==='user'?'selected':''}>user</option>
                    <option value="moderator" ${u.role==='moderator'?'selected':''}>moderatör</option>
                    <option value="admin" ${u.role==='admin'?'selected':''}>admin</option></select>`:''}
                <button onclick="toggleBan('${u.id}',${!u.banned})" class="p-2 rounded-full ${u.banned?'text-green-600 hover:bg-green-50':'text-error hover:bg-error/10'}" title="${u.banned?'Yasağı Kaldır':'Yasakla'}"><span class="material-symbols-outlined text-lg">${u.banned?'lock_open':'block'}</span></button>
            </div>`).join('');
    }
    async function setRole(id,role){
        const { error }=await supabaseClient.from('profiles').update({role}).eq('id',id);
        showToast(error?'Hata':'Güncellendi',error?'Yetki değiştirilemedi':'Kullanıcı yetkisi: '+role,error?'error':'verified_user',!!error);
    }
    async function toggleBan(id,banned){
        const { error }=await supabaseClient.from('profiles').update({banned}).eq('id',id);
        if(!error){ showToast(banned?'Yasaklandı':'Yasak Kaldırıldı','İşlem başarılı.',banned?'block':'lock_open'); loadAdminUsers(); }
        else showToast('Hata','İşlem başarısız.','error',true);
    }
    async function loadAdminQuestions(){
        const { data }=await supabaseClient.from('questions').select('*').order('created_at',{ascending:false}).limit(100);
        document.getElementById('adminQuestions').innerHTML=(data||[]).map(q=>`
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 flex items-center gap-3">
                <div class="flex-1 min-w-0"><p class="font-bold text-sm truncate">${escapeHtml(q.title)}</p><p class="text-[10px] text-outline">@${escapeHtml(q.author||'')} • ${q.category||'-'} • ${q.answer_count||0} cevap</p></div>
                <button onclick="window.location.href='${buildUrl(q)}'" class="p-2 text-secondary"><span class="material-symbols-outlined text-lg">open_in_new</span></button>
                <button onclick="adminDeleteQuestion(${q.id})" class="p-2 text-error hover:bg-error/10 rounded-full"><span class="material-symbols-outlined text-lg">delete</span></button>
            </div>`).join('');
    }
    async function adminDeleteQuestion(id){
        if(!confirm('Bu konuyu silmek istediğinize emin misiniz?')) return;
        await supabaseClient.from('questions').delete().eq('id',id);
        showToast('Silindi','Konu kaldırıldı.'); loadAdminQuestions();
    }
    async function loadAdminCategories(){
        document.getElementById('adminCatList').innerHTML=categoriesCache.map(c=>`
            <div class="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 flex items-center justify-between">
                <span class="text-sm font-bold">${escapeHtml(c.name)} <span class="text-outline font-normal">/${c.slug}</span></span>
                <button onclick="deleteCategory(${c.id})" class="p-1 text-error hover:bg-error/10 rounded-full"><span class="material-symbols-outlined text-lg">delete</span></button>
            </div>`).join('');
    }
    async function deleteCategory(id){
        if(!confirm('Kategori silinsin mi?')) return;
        await supabaseClient.from('categories').delete().eq('id',id);
        await loadCategories(); loadAdminCategories(); showToast('Silindi','Kategori kaldırıldı.');
    }

    /* ---------------- SİLME (sahip/staff) ---------------- */
    async function deleteQuestion(id){
        if(!confirm('Bu soruyu kalıcı olarak silmek istediğinize emin misiniz?')) return;
        const { error }=await supabaseClient.from('questions').delete().eq('id',id);
        if(!error){ showToast('Silindi','Soru kaldırıldı.'); window.location.href='/forum/'; } else showToast('Hata','Silinemedi.','error',true);
    }
    async function deleteAnswer(id,qid){
        if(!confirm('Bu cevabı silmek istiyor musunuz?')) return;
        const { error }=await supabaseClient.from('answers').delete().eq('id',id);
        if(!error){ showToast('Cevap Silindi','İşlem başarılı.'); loadAnswers(qid); }
    }

    /* ---------------- SIDEBAR VERİLERİ ---------------- */
    async function loadSidebarData(){
        const since=new Date(Date.now()-120000).toISOString();
        const [{ count:qc },{ count:ac },{ count:uc },{ data:online }]=await Promise.all([
            supabaseClient.from('questions').select('*',{count:'exact',head:true}),
            supabaseClient.from('answers').select('*',{count:'exact',head:true}),
            supabaseClient.from('profiles').select('*',{count:'exact',head:true}),
            supabaseClient.from('profiles').select('username,avatar_url').gt('last_seen',since).limit(8)
        ]);
        document.getElementById('statTotalQuestions').innerText=qc||0;
        document.getElementById('statTotalAnswers').innerText=ac||0;
        document.getElementById('statActiveExperts').innerText=uc||0;
        const ul=document.getElementById('onlineUsers');
        ul.innerHTML=(online&&online.length)?online.map(u=>`
            <li class="flex items-center gap-2 cursor-pointer hover:opacity-80" onclick="window.location.href='/forum/?u=${encodeURIComponent(u.username)}'">
                <div class="relative"><img src="${u.avatar_url}" class="w-7 h-7 rounded-full object-cover" alt="" loading="lazy" decoding="async"/><span class="absolute bottom-0 right-0 w-2 h-2 rounded-full border border-inverse-surface online-dot"></span></div>
                <span class="text-xs text-white/80">@${escapeHtml(u.username)}</span>
            </li>`).join('') : '<li class="text-white/40 text-xs">Şu an çevrimiçi üye yok.</li>';
    }

    /* ---------------- REALTIME ---------------- */
    function setupRealtime(){
        supabaseClient.channel('rt-questions').on('postgres_changes',{event:'INSERT',schema:'public',table:'questions'},(payload)=>{
            if(profile&&payload.new.author_id===profile.id) return;
            showToast('Yeni Konu','@'+(payload.new.author||'biri')+' yeni soru sordu','forum');
            if(!new URLSearchParams(location.search).get('s')) loadLatestQuestions();
        }).subscribe();

        supabaseClient.channel('rt-messages').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},(payload)=>{
            if(!profile||payload.new.receiver_id!==profile.id) return;
            showToast('Yeni Mesaj','Yeni bir mesajın var','chat');
            loadUnreadCounts();
            if(activeChatUser&&payload.new.sender_id===activeChatUser.id) loadThread();
        }).subscribe();

        supabaseClient.channel('rt-notifs').on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications'},(payload)=>{
            if(!profile||payload.new.user_id!==profile.id) return;
            showToast('Bildirim',payload.new.content,'notifications');
            loadUnreadCounts();
        }).subscribe();
    }

    /* ---------------- SEO ŞEMASI ---------------- */
    function setMeta(id,attr,val){ const el=document.getElementById(id); if(el) el.setAttribute(attr,val); }

    function injectSchema(q,answers){
        const url=SITE_ORIGIN+buildUrl(q);
        const desc=stripHtml(q.content).slice(0,160);
        const categoryName=(categoriesCache.find(c=>c.slug===q.category)||{}).name||q.category||'Genel';
        const authorUrl=SITE_ORIGIN+'/forum/?u='+encodeURIComponent(q.author||'');
        const answerList=(answers||[]).slice(0,50).map(a=>({
            "@type":"Comment",
            "text":stripHtml(a.content),
            "dateCreated":a.created_at,
            "upvoteCount":a.votes||0,
            "author":{ "@type":"Person","name":a.author||"anonim","url":SITE_ORIGIN+'/forum/?u='+encodeURIComponent(a.author||'') }
        }));

        const questionNode={
            "@type":"Question",
            "name":q.title,
            "text":stripHtml(q.content),
            "answerCount":q.answer_count||0,
            "upvoteCount":q.votes||0,
            "datePublished":q.created_at,
            "dateModified":q.updated_at||q.created_at,
            "url":url,
            "author":{ "@type":"Person","name":q.author||"anonim","url":authorUrl }
        };
        if(answerList.length){
            const top=answerList[0];
            if(top.upvoteCount>0){ questionNode.acceptedAnswer=top; questionNode.suggestedAnswer=answerList.slice(1); }
            else questionNode.suggestedAnswer=answerList;
        }

        const qaSchema={ "@context":"https://schema.org","@type":"QAPage","mainEntity":questionNode };

        // Forum tartışması olarak da işaretle (DiscussionForumPosting) — arama motorları
        // ve forum-özel zengin sonuçlar için Question ile birlikte kullanılabilir.
        const discussionSchema={
            "@context":"https://schema.org",
            "@type":"DiscussionForumPosting",
            "headline":q.title,
            "text":stripHtml(q.content),
            "datePublished":q.created_at,
            "dateModified":q.updated_at||q.created_at,
            "url":url,
            "commentCount":q.answer_count||0,
            "interactionStatistic":[
                { "@type":"InteractionCounter","interactionType":"https://schema.org/LikeAction","userInteractionCount":q.votes||0 },
                { "@type":"InteractionCounter","interactionType":"https://schema.org/CommentAction","userInteractionCount":q.answer_count||0 }
            ],
            "author":{ "@type":"Person","name":q.author||"anonim","url":authorUrl },
            "isPartOf":{ "@type":"WebSite","name":"DMOZ Q&A","url":SITE_ORIGIN+'/forum/' }
        };
        if(answerList.length) discussionSchema.comment=answerList;
        if(q.image_url) discussionSchema.image={ "@type":"ImageObject","url":q.image_url,"contentUrl":q.image_url };

        const breadcrumbSchema={
            "@context":"https://schema.org",
            "@type":"BreadcrumbList",
            "itemListElement":[
                { "@type":"ListItem","position":1,"name":"Anasayfa","item":SITE_ORIGIN+"/forum/" },
                { "@type":"ListItem","position":2,"name":categoryName,"item":SITE_ORIGIN+buildCategoryUrl(q.category||'genel') },
                { "@type":"ListItem","position":3,"name":q.title,"item":url }
            ]
        };

        const webPageSchema={
            "@context":"https://schema.org","@type":"WebPage",
            "name":q.title,"url":url,"description":desc,"inLanguage":"tr-TR",
            "datePublished":q.created_at,"dateModified":q.updated_at||q.created_at,
            "isPartOf":{ "@type":"WebSite","name":"DMOZ Q&A","url":SITE_ORIGIN+'/forum/' },
            "publisher":{ "@type":"Organization","name":"DMOZ Q&A","url":SITE_ORIGIN+"/forum/","logo":{ "@type":"ImageObject","url":SITE_ORIGIN+"/forum/og-cover.png" } }
        };

        const schemas=[qaSchema,discussionSchema,breadcrumbSchema,webPageSchema];
        if(q.image_url) schemas.push({ "@context":"https://schema.org","@type":"ImageObject","url":q.image_url,"contentUrl":q.image_url,"name":q.title });

        document.getElementById('json-ld-schema').textContent=JSON.stringify(schemas);

        document.title=`${q.title} | DMOZ Q&A`;
        setMeta('canonicalLink','href',url);
        let meta=document.querySelector('meta[name="description"]'); if(meta) meta.setAttribute('content',desc);
        let kw=document.querySelector('meta[name="keywords"]');
        if(kw) kw.setAttribute('content',autoSeoKeywords(q.title,q.tags,categoryName));
        setMeta('ogType','content','article');
        setMeta('ogTitle','content',q.title);
        setMeta('ogDesc','content',desc);
        setMeta('ogUrl','content',url);
        setMeta('twTitle','content',q.title);
        setMeta('twDesc','content',desc);
        if(q.image_url){ setMeta('ogImage','content',q.image_url); setMeta('twImage','content',q.image_url); }
    }

    /* Başlıktan otomatik SEO anahtar kelimesi üretimi: başlık kelimeleri + etiketler
       + kategori adı birleştirilip yinelenenler/durak sözcükler ayıklanır. */
    const TR_STOPWORDS=new Set(['ve','ile','bir','bu','şu','o','de','da','mi','mı','mu','mü','için','gibi','ama','fakat','veya','ya','ne','neden','nasıl','mı?','nedir','midir']);
    function autoSeoKeywords(title,tags,categoryName){
        const fromTitle=(title||'').toLowerCase().replace(/[^\wçğıöşüİ\s-]/g,' ').split(/\s+/).filter(w=>w.length>2&&!TR_STOPWORDS.has(w));
        const fromTags=(tags||'').split(',').map(t=>t.trim().toLowerCase()).filter(Boolean);
        const all=[...new Set([...fromTags,...fromTitle,(categoryName||'').toLowerCase()])].filter(Boolean);
        return all.slice(0,12).join(', ');
    }

    function injectHomeSchema(){
        const defaultDesc='DMOZ Q&A - Uzman topluluğuyla soru sor, cevap ver, bilgini paylaş. Yazılım, donanım, yapay zeka ve kariyer üzerine binlerce soru ve cevap.';
        const schema=[
            {
                "@context":"https://schema.org",
                "@type":"WebSite",
                "name":"DMOZ Q&A",
                "url":SITE_ORIGIN+"/forum/",
                "inLanguage":"tr-TR",
                "potentialAction":{
                    "@type":"SearchAction",
                    "target":{ "@type":"EntryPoint","urlTemplate":SITE_ORIGIN+"/forum/?q={search_term_string}" },
                    "query-input":"required name=search_term_string"
                }
            },
            {
                "@context":"https://schema.org",
                "@type":"Organization",
                "name":"DMOZ Q&A",
                "url":SITE_ORIGIN+"/forum/",
                "logo":{ "@type":"ImageObject","url":SITE_ORIGIN+"/forum/og-cover.png" }
            },
            {
                "@context":"https://schema.org","@type":"WebPage",
                "name":"DMOZ Q&A | Bilgi Paylaşım Platformu","url":SITE_ORIGIN+"/forum/",
                "description":defaultDesc,"inLanguage":"tr-TR",
                "isPartOf":{ "@type":"WebSite","name":"DMOZ Q&A","url":SITE_ORIGIN+'/forum/' }
            }
        ];
        document.getElementById('json-ld-schema').textContent=JSON.stringify(schema);
        document.title='DMOZ Q&A | Bilgi Paylaşım Platformu';
        let meta=document.querySelector('meta[name="description"]'); if(meta) meta.setAttribute('content',defaultDesc);
        let kw=document.querySelector('meta[name="keywords"]'); if(kw) kw.setAttribute('content','soru cevap, q&a, forum, bilgi paylaşımı, yazılım, yapay zeka');
        setMeta('canonicalLink','href',SITE_ORIGIN+'/forum/');
        setMeta('ogType','content','website');
        setMeta('ogTitle','content','DMOZ Q&A | Bilgi Paylaşım Platformu');
        setMeta('ogDesc','content',defaultDesc);
        setMeta('ogUrl','content',SITE_ORIGIN+'/forum/');
        setMeta('twTitle','content','DMOZ Q&A | Bilgi Paylaşım Platformu');
        setMeta('twDesc','content',defaultDesc);
    }

    /* ---------------- ZENGİN EDİTÖR ---------------- */
    function setupEditor(){
        document.querySelectorAll('.editor-tool').forEach(btn=>{
            btn.addEventListener('click',()=>{ const cmd=btn.dataset.cmd; const val=btn.dataset.val||null; document.execCommand(cmd,false,val); document.getElementById('richEditor').focus(); });
        });
        document.getElementById('insertImageBtn').addEventListener('click',()=>{ const url=prompt('Resim URL adresi:'); if(url){ document.execCommand('insertHTML',false,`<img src="${url}" alt="resim"/>`); } });
        document.getElementById('insertVideoBtn').addEventListener('click',()=>{
            const url=prompt('Video URL (YouTube veya mp4):');
            if(!url) return;
            let embed;
            const yt=url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]{11})/);
            if(yt){ embed=`<iframe width="100%" height="315" src="https://www.youtube.com/embed/${yt[1]}" frameborder="0" allowfullscreen style="border-radius:.5rem;margin:.5rem 0"></iframe>`; }
            else { embed=`<video src="${url}" controls></video>`; }
            document.execCommand('insertHTML',false,embed);
        });
        document.getElementById('insertLinkBtn').addEventListener('click',()=>{ const url=prompt('Bağlantı URL:'); if(url){ document.execCommand('createLink',false,url); } });
    }

    /* ---------------- OLAY DİNLEYİCİLER ---------------- */
    function setupEventListeners(){
        // Soru modalı
        document.getElementById('openModalBtn')?.addEventListener('click',()=>{ if(requireAuth()) toggleModal('questionModal',true); });
        document.getElementById('mobileAskBtn')?.addEventListener('click',()=>{ if(requireAuth()) toggleModal('questionModal',true); });
        document.getElementById('closeModalBtn')?.addEventListener('click',()=>toggleModal('questionModal',false));
        document.getElementById('cancelModalBtn')?.addEventListener('click',()=>toggleModal('questionModal',false));
        setupEditor();

        // Soru gönderme
        document.getElementById('askQuestionForm')?.addEventListener('submit',async(e)=>{
            e.preventDefault();
            if(!requireAuth()) return;
            if(honeypotTripped('askHoneypot')) return;
            if(floodBlocked('ask',6000)){ showToast('Yavaşlayın','Çok hızlı gönderim yapıyorsunuz, birkaç saniye bekleyin.','hourglass_empty',true); return; }
            const title=document.getElementById('qTitle').value.trim();
            const content=document.getElementById('richEditor').innerHTML.trim();
            let category=document.getElementById('qCategory').value;
            let tags=document.getElementById('qTags').value.trim();
            if(!title||!content){ showToast('Eksik Bilgi','Başlık ve içerik zorunludur.','warning',true); return; }
            try{
                if(!tags) tags=title.split(' ').filter(w=>w.length>4).slice(0,3).join(', ');
                const { data:inserted, error }=await supabaseClient.from('questions').insert([{ title, content, category, tags, author:profile.username, author_id:profile.id, views:0, votes:0, answer_count:0 }]).select().single();
                if(error) throw error;
                toggleModal('questionModal',false);
                showToast('Başarılı','Konunuz yayınlandı!');
                e.target.reset(); document.getElementById('richEditor').innerHTML='';
                window.location.href=buildUrl(inserted);
            }catch(err){ console.error('[v0] post question',err); showToast('Hata','Konu gönderilemedi.','error',true); }
        });

        // AUTH modal sekmeleri
        document.getElementById('loginBtn')?.addEventListener('click',()=>toggleModal('authModal',true));
        document.getElementById('closeAuthBtn').addEventListener('click',()=>toggleModal('authModal',false));
        document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>switchAuthTab(btn.dataset.tab)));

        // Giriş
        document.getElementById('loginForm').addEventListener('submit',async(e)=>{
            e.preventDefault();
            if(honeypotTripped('loginHoneypot')) return; // bot yakalandı, sessizce yoksay
            if(floodBlocked('login',2000)) return;
            let identifier=document.getElementById('loginIdentifier').value.trim();
            const password=document.getElementById('loginPassword').value;
            let email=identifier;
            if(!identifier.includes('@')){
                const { data }=await supabaseClient.from('profiles').select('email').eq('username',identifier).single();
                if(!data){ showToast('Hata','Kullanıcı bulunamadı.','error',true); return; }
                email=data.email;
            }
            const { error }=await supabaseClient.auth.signInWithPassword({ email, password });
            if(error){ showToast('Giriş Başarısız',error.message,'error',true); return; }
            toggleModal('authModal',false);
            showToast('Hoş geldin','Giriş başarılı!','verified_user');
            await loadSession(); route();
        });

        // Kayıt
        document.getElementById('registerForm').addEventListener('submit',async(e)=>{
            e.preventDefault();
            if(honeypotTripped('registerHoneypot')) return;
            if(floodBlocked('register',5000)) return;
            const username=document.getElementById('regUsername').value.trim();
            const email=document.getElementById('regEmail').value.trim();
            const password=document.getElementById('regPassword').value;
            // kullanıcı adı uygunluk
            const { data:exists }=await supabaseClient.from('profiles').select('id').eq('username',username).maybeSingle();
            if(exists){ showToast('Hata','Bu kullanıcı adı alınmış.','error',true); return; }
            const { data,error }=await supabaseClient.auth.signUp({ email, password, options:{ data:{ username, full_name:username } } });
            if(error){ showToast('Kayıt Başarısız',error.message,'error',true); return; }
            if(!data.session){
                // e-posta onayı açıksa otomatik giriş dene
                await supabaseClient.auth.signInWithPassword({ email, password });
            }
            toggleModal('authModal',false);
            showToast('Tebrikler','Üyeliğin oluştu, mavi tik kazandın!','verified');
            await loadSession(); route();
        });

        // Şifremi unuttum
        document.getElementById('forgotBtn').addEventListener('click',async()=>{
            const id=document.getElementById('loginIdentifier').value.trim();
            let email=id;
            if(id&&!id.includes('@')){ const { data }=await supabaseClient.from('profiles').select('email').eq('username',id).single(); email=data?.email; }
            if(!email){ showToast('E-posta Gerekli','Lütfen e-posta adresinizi girin.','mail',true); return; }
            const { error }=await supabaseClient.auth.resetPasswordForEmail(email);
            showToast(error?'Hata':'Gönderildi',error?error.message:'Şifre sıfırlama bağlantısı e-postanıza gönderildi.',error?'error':'mail',!!error);
        });

        // Profil düzenleme
        document.getElementById('closeEditProfile').addEventListener('click',()=>toggleModal('editProfileModal',false));
        document.getElementById('cancelEditProfile').addEventListener('click',()=>toggleModal('editProfileModal',false));
        document.getElementById('avatarFile').addEventListener('change',async(e)=>{
            const file=e.target.files[0]; if(!file) return;
            const path=`${profile.id}/${Date.now()}-${file.name}`;
            const { error }=await supabaseClient.storage.from('avatars').upload(path,file,{upsert:true});
            if(error){ showToast('Hata','Avatar yüklenemedi: '+error.message,'error',true); return; }
            const { data }=supabaseClient.storage.from('avatars').getPublicUrl(path);
            document.getElementById('editAvatarPreview').src=data.publicUrl;
            document.getElementById('editAvatarPreview').dataset.url=data.publicUrl;
        });
        document.getElementById('editProfileForm').addEventListener('submit',async(e)=>{
            e.preventDefault();
            const updates={
                full_name:document.getElementById('epFullName').value.trim(),
                city:document.getElementById('epCity').value.trim(),
                zodiac:document.getElementById('epZodiac').value,
                profession:document.getElementById('epProfession').value.trim(),
                bio:document.getElementById('epBio').value.trim(),
                social_twitter:document.getElementById('epTwitter').value.trim(),
                social_instagram:document.getElementById('epInstagram').value.trim(),
                social_website:document.getElementById('epWebsite').value.trim()
            };
            const newAvatar=document.getElementById('editAvatarPreview').dataset.url;
            if(newAvatar) updates.avatar_url=newAvatar;
            const { error }=await supabaseClient.from('profiles').update(updates).eq('id',profile.id);
            if(error){ showToast('Hata','Profil güncellenemedi.','error',true); return; }
            Object.assign(profile,updates);
            toggleModal('editProfileModal',false);
            showToast('Kaydedildi','Profilin güncellendi.');
            renderUserArea(); renderUserProfile(profile.username);
        });

        // Drawer açma
        document.getElementById('notificationsBtn').addEventListener('click',openNotifications);
        document.getElementById('messagesBtn').addEventListener('click',openMessages);
        document.getElementById('adminBtn').addEventListener('click',openAdmin);
        document.getElementById('mobileNotifBtn').addEventListener('click',openNotifications);
        document.getElementById('mobileMsgBtn').addEventListener('click',openMessages);
        document.getElementById('mobileProfileBtn').addEventListener('click',()=>{ if(profile) window.location.href='/forum/?u='+encodeURIComponent(profile.username); else toggleModal('authModal',true); });
        document.getElementById('drawerOverlay').addEventListener('click',closeDrawers);
        document.querySelectorAll('.close-drawer').forEach(b=>b.addEventListener('click',closeDrawers));
        document.getElementById('msgBackBtn').addEventListener('click',showConversationList);

        // Mesaj gönderme
        document.getElementById('msgSendForm').addEventListener('submit',async(e)=>{
            e.preventDefault();
            const input=document.getElementById('msgInput'); const content=input.value.trim();
            if(!content||!activeChatUser) return;
            const { error }=await supabaseClient.from('messages').insert([{ sender_id:profile.id, receiver_id:activeChatUser.id, content }]);
            if(error){ showToast('Hata','Mesaj gönderilemedi.','error',true); return; }
            input.value=''; loadThread();
            await supabaseClient.from('notifications').insert([{ user_id:activeChatUser.id, type:'message', content:`@${profile.username} sana mesaj gönderdi`, link:'#' }]);
        });

        // Admin sekmeleri
        document.querySelectorAll('.admin-tab').forEach(btn=>btn.addEventListener('click',()=>{
            document.querySelectorAll('.admin-tab').forEach(b=>{ b.classList.remove('text-primary','border-primary'); b.classList.add('text-on-surface-variant','border-transparent'); });
            btn.classList.add('text-primary','border-primary'); btn.classList.remove('text-on-surface-variant','border-transparent');
            const t=btn.dataset.atab;
            document.getElementById('adminUsers').classList.toggle('hidden',t!=='users');
            document.getElementById('adminQuestions').classList.toggle('hidden',t!=='questions');
            document.getElementById('adminCategories').classList.toggle('hidden',t!=='categories');
            if(t==='questions') loadAdminQuestions();
            if(t==='categories') loadAdminCategories();
        }));
        document.getElementById('adminAddCatForm').addEventListener('submit',async(e)=>{
            e.preventDefault();
            const name=document.getElementById('adminNewCat').value.trim(); if(!name) return;
            const { error }=await supabaseClient.from('categories').insert([{ name, slug:slugify(name) }]);
            if(!error){ document.getElementById('adminNewCat').value=''; await loadCategories(); loadAdminCategories(); showToast('Eklendi','Kategori oluşturuldu.'); }
            else showToast('Hata','Kategori eklenemedi (mevcut olabilir).','error',true);
        });

        // Arama (masaüstü + mobil ortak)
        function wireSearch(inputEl,resultsEl,badgeEl){
            if(!inputEl||!resultsEl) return;
            let debounceTimer=null;
            inputEl.addEventListener('input',(e)=>{
                clearTimeout(debounceTimer);
                const val=e.target.value.trim();
                if(val.length<=2){ resultsEl.classList.add('hidden'); badgeEl?.classList.replace('flex','hidden'); return; }
                debounceTimer=setTimeout(async()=>{
                    badgeEl?.classList.replace('hidden','flex');
                    const { data }=await supabaseClient.from('questions').select('id,title,category').ilike('title',`%${val}%`).limit(8);
                    resultsEl.classList.remove('hidden');
                    resultsEl.innerHTML=(data&&data.length)?data.map(q=>`
                        <div class="p-3 hover:bg-primary-container/10 rounded-lg cursor-pointer flex items-center gap-3 transition-colors" onclick="window.location.href='${buildUrl(q)}'">
                            <span class="material-symbols-outlined text-primary text-sm">search</span>
                            <span class="text-sm text-on-surface-variant font-medium line-clamp-1">${escapeHtml(q.title)}</span>
                        </div>`).join('') : '<div class="p-3 text-xs text-outline italic">Sonuç bulunamadı.</div>';
                },300);
            });
        }
        wireSearch(document.getElementById('ajaxSearch'),document.getElementById('searchResults'),document.getElementById('searchBadge'));
        wireSearch(document.getElementById('ajaxSearchMobile'),document.getElementById('searchResultsMobile'),null);
        document.addEventListener('click',(e)=>{
            if(!e.target.closest('#ajaxSearch')&&!e.target.closest('#searchResults')) document.getElementById('searchResults')?.classList.add('hidden');
            if(!e.target.closest('#mobileSearchPanel')&&!e.target.closest('#mobileSearchBtn')) document.getElementById('mobileSearchPanel')?.classList.add('hidden');
        });
        document.getElementById('mobileSearchBtn')?.addEventListener('click',()=>{
            const panel=document.getElementById('mobileSearchPanel');
            panel.classList.toggle('hidden');
            if(!panel.classList.contains('hidden')) document.getElementById('ajaxSearchMobile')?.focus();
        });

        // Sıralama
        document.getElementById('sortNew')?.addEventListener('click',function(){ this.classList.add('bg-white','shadow-sm','text-primary'); document.getElementById('sortPopular').classList.remove('bg-white','shadow-sm','text-primary'); loadLatestQuestions('created_at'); });
        document.getElementById('sortPopular')?.addEventListener('click',function(){ this.classList.add('bg-white','shadow-sm','text-primary'); document.getElementById('sortNew').classList.remove('bg-white','shadow-sm','text-primary'); loadLatestQuestions('popular'); });

        // çıkışta çevrimdışı işaretle
        window.addEventListener('beforeunload',()=>{ if(profile) navigator.sendBeacon&&supabaseClient.from('profiles').update({last_seen:new Date(Date.now()-200000).toISOString()}).eq('id',profile.id); });
    }

    function switchAuthTab(tab){
        const isLogin=tab==='login';
        document.getElementById('loginForm').classList.toggle('hidden',!isLogin);
        document.getElementById('registerForm').classList.toggle('hidden',isLogin);
        document.getElementById('tabLogin').classList.toggle('text-primary',isLogin);
        document.getElementById('tabLogin').classList.toggle('border-primary',isLogin);
        document.getElementById('tabLogin').classList.toggle('text-on-surface-variant',!isLogin);
        document.getElementById('tabLogin').classList.toggle('border-transparent',!isLogin);
        document.getElementById('tabRegister').classList.toggle('text-primary',!isLogin);
        document.getElementById('tabRegister').classList.toggle('border-primary',!isLogin);
        document.getElementById('tabRegister').classList.toggle('text-on-surface-variant',isLogin);
        document.getElementById('tabRegister').classList.toggle('border-transparent',isLogin);
    }

    document.addEventListener('DOMContentLoaded',init);

export default {
    async fetch(request, env, ctx) {
        const cache = caches.default;
        const url = new URL(request.url);

        // 統一 CORS Headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': 'https://coojiin.github.io',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': 'application/json'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        // 1. 嘗試匹配快取
        let response = await cache.match(request);

        if (response) {
            // 取得快取的產生時間
            const cacheDate = new Date(response.headers.get('Date'));
            const ageInSeconds = (new Date() - cacheDate) / 1000;

            // --- 專業級 SWR 判斷邏輯 ---
            if (ageInSeconds < 60) {
                // A. 極度新鮮：直接回傳，完全不擾動 API
                return response;
            } else if (ageInSeconds < 3600) {
                // B. 資料變舊了 (SWR 核心)：先給舊的 (秒開)，在背景偷偷更新一次
                // ctx.waitUntil 確保 Worker 在回傳後繼續運行背景任務
                ctx.waitUntil(updateCache(request, env, ctx, corsHeaders));
                return response;
            }
            // C. 超過一小時：邏輯會跳出 if (response)，執行下方的強制更新
        }

        // 2. Cache Miss 或資料太舊 (超過一小時)：強迫等待更新
        return await updateCache(request, env, ctx, corsHeaders);
    }
};

async function updateCache(request, env, ctx, corsHeaders) {
    const cache = caches.default;
    const url = new URL(request.url);

    const API_KEY = env.GOOGLE_API_KEY;
    const LUNCH_ID = env.LUNCH_FOLDER_ID;
    const DINNER_ID = env.DINNER_FOLDER_ID;

    const type = url.searchParams.get('type');
    const folderId = (type === 'dinner') ? DINNER_ID : LUNCH_ID;

    const googleApiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&key=${API_KEY}&fields=files(id,name,mimeType,thumbnailLink,webContentLink)&pageSize=1000`;

    try {
        const driveResponse = await fetch(googleApiUrl, {
            headers: { 'Referer': 'https://company-menu.coojiin.workers.dev' }
        });

        const data = await driveResponse.json();

        // 建立 Response
        // 這裡 s-maxage 設長一點 (例如一天)，是為了讓 cache.match 之後還能找得到舊資料
        // 我們手動在上面的 Worker 邏輯中控制何時該重新抓取
        const response = new Response(JSON.stringify(data), {
            headers: {
                ...corsHeaders,
                'Cache-Control': 'public, s-maxage=86400',
                'Date': new Date().toUTCString() // 強制寫入正確的時間標頭
            }
        });

        // 非同步寫入快取
        ctx.waitUntil(cache.put(request, response.clone()));

        return response;
    } catch (e) {
        return new Response(JSON.stringify({ error: "Google API 串接失敗" }), {
            status: 500,
            headers: corsHeaders
        });
    }
}
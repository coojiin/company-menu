export default {
    async fetch(request, env, ctx) {
        const cache = caches.default;
        const url = new URL(request.url);

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
            const cacheDate = new Date(response.headers.get('Date'));
            const ageInSeconds = (new Date() - cacheDate) / 1000;

            if (ageInSeconds < 60) {
                // 60秒內：極度新鮮，直接回傳
                return response;
            } else if (ageInSeconds < 3600) {
                // 1小時內：SWR 觸發背景更新
                ctx.waitUntil(updateCache(request, env, ctx, corsHeaders));
                return response;
            }
        }

        // 2. 無快取或超過1小時：強制更新
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

        // --- 防呆機制：只有當有檔案時才寫入快取 ---
        if (data.files && data.files.length > 0) {
            const response = new Response(JSON.stringify(data), {
                headers: {
                    ...corsHeaders,
                    'Cache-Control': 'public, s-maxage=86400',
                    'Date': new Date().toUTCString()
                }
            });
            // 只有正確資料才存入 Cloudflare 節點
            ctx.waitUntil(cache.put(request, response.clone()));
            return response;
        } else {
            // 如果是空的，直接回傳但不存快取，讓下次請求能再次嘗試
            return new Response(JSON.stringify(data), {
                headers: { ...corsHeaders, 'Cache-Control': 'no-store' }
            });
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: "API Fail" }), {
            status: 500,
            headers: corsHeaders
        });
    }
}
export async function onRequest(context) {
  // 1. 從環境變數讀取 (稍後在 Cloudflare 後台設定)
  const API_KEY = context.env.GOOGLE_API_KEY;
  const LUNCH_ID = context.env.LUNCH_FOLDER_ID;
  const DINNER_ID = context.env.DINNER_FOLDER_ID;

  // 2. 取得前端傳來的參數 (例如 ?type=lunch)
  const { searchParams } = new URL(context.request.url);
  const type = searchParams.get('type');

  // 根據類型選擇對應的 Folder ID
  const folderId = (type === 'dinner') ? DINNER_ID : LUNCH_ID;

  // 3. 呼叫 Google Drive API (假設你是用這隻 API)
  const googleApiUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents&key=${API_KEY}&fields=files(id,name,webContentLink,thumbnailLink)`;

  try {
    const response = await fetch(googleApiUrl);
    const data = await response.json();

    // 4. 回傳結果給前端
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "API 請求失敗" }), { status: 500 });
  }
}

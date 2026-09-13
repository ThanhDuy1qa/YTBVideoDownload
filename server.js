const express = require('express');
const ytSearch = require('yt-search');
const dns = require('dns');

// Ép Node.js ưu tiên phân giải IP qua IPv4 để sửa triệt để lỗi ENOTFOUND trên Render/Docker
dns.setDefaultResultOrder('ipv4first');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.use(express.json());

// Helper bóc tách Video ID từ URL YouTube
function getYouTubeVideoId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// ==========================================
// 1. API Tìm kiếm từ khóa (yt-search)
// ==========================================
app.get('/api/parse', async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Thiếu thông tin tìm kiếm' });

  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const r = await ytSearch(query);
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const videos = r.videos.slice(startIndex, endIndex).map(v => ({
      id: v.videoId,
      url: v.url,
      title: v.title,
      thumbnail: v.thumbnail,
      duration: v.timestamp,
      author: v.author.name
    }));

    res.json({ type: 'search', videos, hasMore: endIndex < r.videos.length });
  } catch (err) {
    console.error('Lỗi search:', err);
    res.status(500).json({ error: 'Lỗi hệ thống khi tìm kiếm dữ liệu.' });
  }
});

// ==========================================
// 2. API Tải Xuống (Hệ thống API Fallback đa tầng)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  const isMp3 = format === 'mp3';
  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Kênh 1: Sử dụng Cobalt API v10 với Header giả lập trình duyệt
  try {
    const cobaltRes = await fetch('https://api.cobalt.tools', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      },
      body: JSON.stringify({
        url: targetUrl,
        downloadMode: isMp3 ? 'audio' : 'auto',
        audioFormat: 'mp3'
      })
    });

    if (cobaltRes.ok) {
      const data = await cobaltRes.json();
      if (data && data.url) {
        return res.redirect(data.url);
      }
    }
  } catch (e) {
    console.log('Kênh Cobalt bận, chuyển sang kênh dự phòng 2...');
  }

  // Kênh 2: Dự phòng qua dịch vụ Loader Engine
  try {
    const loaderRes = await fetch(`https://api.vevioz.com/api/button/${isMp3 ? 'mp3' : 'videos'}/${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (loaderRes.ok) {
      const html = await loaderRes.text();
      const match = html.match(/href="(https:\/\/[^"]+)"/);
      if (match && match[1]) {
        return res.redirect(match[1]);
      }
    }
  } catch (e) {
    console.log('Kênh Vevioz bận, thử giải pháp kết nối trực tiếp...');
  }

  return res.status(500).send('Tất cả máy chủ chuyển đổi hiện đang bận. Vui lòng bấm thử lại sau 5 giây!');
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
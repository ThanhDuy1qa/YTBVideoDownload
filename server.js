const express = require('express');
const ytSearch = require('yt-search');
const dns = require('dns');

// Ép Node.js ưu tiên IPv4 để khắc phục triệt để lỗi ENOTFOUND trên Render/Docker
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
// 2. API Tải Xuống Trực Tiếp (Dùng YT1S Engine Bypass Cloud IP Ban)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  const isMp3 = format === 'mp3';
  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // Bước 1: Gửi request phân tích video tới YT1S
    const searchRes = await fetch('https://yt1s.com/api/ajaxSearch/index', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({ q: targetUrl, vt: 'home' })
    });

    const searchData = await searchRes.json();

    if (!searchData || searchData.status !== 'ok' || !searchData.links) {
      return res.status(500).send('Máy chủ phân tích bận. Vui lòng bấm thử lại sau 3 giây!');
    }

    let key = '';
    if (isMp3) {
      // Ưu tiên lấy định dạng MP3
      const mp3Links = searchData.links.mp3;
      key = mp3Links?.mp3128?.k || mp3Links?.mp3320?.k || Object.values(mp3Links || {})[0]?.k;
    } else {
      // Ưu tiên lấy định dạng MP4 (360p / 720p có sẵn âm thanh)
      const mp4Links = searchData.links.mp4;
      key = mp4Links?.['18']?.k || mp4Links?.['22']?.k || Object.values(mp4Links || {})[0]?.k;
    }

    if (!key) {
      return res.status(500).send('Không tìm thấy định dạng tải xuống phù hợp.');
    }

    // Bước 2: Tạo đường dẫn tải file trực tiếp (Direct Download CDN)
    const convertRes = await fetch('https://yt1s.com/api/ajaxConvert/convert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: new URLSearchParams({ vid: videoId, k: key })
    });

    const convertData = await convertRes.json();

    if (convertData && convertData.status === 'ok' && convertData.dlink) {
      // Chuyển hướng trực tiếp thiết bị điện thoại / máy tính đến link tải file
      return res.redirect(convertData.dlink);
    } else {
      return res.status(500).send('Không thể khởi tạo đường dẫn file. Vui lòng thử lại!');
    }

  } catch (err) {
    console.error('Lỗi xử lý API:', err);
    return res.status(500).send('Lỗi kết nối máy chủ xử lý.');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
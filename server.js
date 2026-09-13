const express = require('express');
const ytSearch = require('yt-search');
const { spawn } = require('child_process');
const fs = require('fs'); // Thêm thư viện fs để kiểm tra file cookies nếu có
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
// 2. API Tải Xuống Trực Tiếp (Dùng Cobalt API)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  const targetUrl = `https://www.youtube.com/watch?v=${videoId}`;

  try {
    // Gửi request tới Cobalt API
    const response = await fetch('https://api.cobalt.tools/', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: targetUrl,
        downloadMode: format === 'mp3' ? 'audio' : 'auto',
        audioFormat: 'mp3',
        youtubeVideoCodec: 'h264'
      })
    });

    const data = await response.json();

    // Nếu lấy thành công link tải, chuyển hướng thiết bị của người dùng đến file
    if (data && data.url) {
      return res.redirect(data.url);
    } else if (data && data.picker) {
      // Trường hợp trả về danh sách link stream
      return res.redirect(data.picker[0].url);
    } else {
      console.error('Lỗi Cobalt Response:', data);
      return res.status(500).send('Cobalt không thể lấy link tải video này.');
    }
  } catch (err) {
    console.error('Lỗi kết nối Cobalt API:', err);
    return res.status(500).send('Lỗi kết nối máy chủ xử lý video.');
  }
});
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
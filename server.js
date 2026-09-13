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
// ==========================================
// 2. API Tải Xuống Trực Tiếp (Dùng Piped API)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  try {
    // Gọi API của Piped để lấy danh sách stream
    const response = await fetch(`https://api.piped.video/streams/${videoId}`);
    
    if (!response.ok) {
      return res.status(500).send('Máy chủ Piped không thể phân tích video này.');
    }

    const data = await response.json();
    const isMp3 = format === 'mp3';

    let targetStream;
    if (isMp3) {
      // Tìm luồng âm thanh (audio stream) có bitrate cao nhất
      targetStream = data.audioStreams?.sort((a, b) => b.bitrate - a.bitrate)[0];
    } else {
      // Tìm luồng video có kèm cả tiếng
      targetStream = data.videoStreams?.find(v => v.videoOnly === false) || data.videoStreams?.[0];
    }

    if (targetStream && targetStream.url) {
      // Chuyển hướng trực tiếp thiết bị của người dùng tới file stream
      return res.redirect(targetStream.url);
    } else {
      return res.status(500).send('Không tìm thấy link tải tương thích.');
    }
  } catch (err) {
    console.error('Lỗi Piped API:', err);
    return res.status(500).send('Lỗi máy chủ khi xử lý video.');
  }
});

// ==========================================
app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
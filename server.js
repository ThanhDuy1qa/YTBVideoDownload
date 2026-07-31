const express = require('express');
const ytSearch = require('yt-search');
const { Readable } = require('stream');
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
// API Xử lý Tìm kiếm từ khóa (yt-search)
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
// API Tải Xuống (Kết nối RapidAPI)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format, quality, title } = req.query; // Nhận thêm tham số 'title'
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY; 
  if (!RAPIDAPI_KEY) return res.status(500).send('Chưa cấu hình RAPIDAPI_KEY');

  // Xác định Endpoint
  let endpoint = `/get_m4a_download_link/${videoId}`;
  let ext = 'm4a';

  if (format === 'mp3') {
    const apiQuality = quality === '320k' ? 'high' : 'low';
    endpoint = `/get_mp3_download_link/${videoId}?quality=${apiQuality}`;
    ext = 'mp3';
  }

  const targetUrl = `https://youtube-mp3-audio-video-downloader.p.rapidapi.com${endpoint}`;

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': 'youtube-mp3-audio-video-downloader.p.rapidapi.com',
        'x-rapidapi-key': RAPIDAPI_KEY
      }
    });

    const data = await response.json();

    if (data && data.file) {
      // 1. Tạo tên file an toàn (xóa ký tự đặc biệt cấm đặt tên file trên Windows/Mac)
      const rawTitle = title || 'youtube_audio';
      const safeTitle = rawTitle.replace(/[/\\?%*:|"<>]/g, '').trim() || 'audio';
      const fileName = `${safeTitle}.${ext}`;

      // 2. Tải luồng dữ liệu file từ RapidAPI về Server
      const fileStreamResponse = await fetch(data.file);
      if (!fileStreamResponse.ok) throw new Error('Không thể tải luồng file từ máy chủ lưu trữ');

      // 3. Thiết lập Header ép trình duyệt tải xuống với đúng TÊN VIDEO
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.setHeader('Content-Type', fileStreamResponse.headers.get('content-type') || 'application/octet-stream');

      // 4. Pipe luồng dữ liệu về máy người dùng
      Readable.fromWeb(fileStreamResponse.body).pipe(res);

    } else {
      console.error('RapidAPI Response:', data);
      return res.status(500).send('Không tìm thấy file tải xuống. Vui lòng thử lại.');
    }
  } catch (err) {
    console.error('Lỗi khi tải file:', err);
    return res.status(500).send(`Lỗi máy chủ: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
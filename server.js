const express = require('express');
const ytSearch = require('yt-search');
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
// 2. API Tải Xuống Trực Tiếp (Dùng Invidious API + Auto Fallback)
// ==========================================
app.get('/api/download', async (req, res) => {
  const { url, format } = req.query;
  if (!url) return res.status(400).send('Thiếu URL video');

  const videoId = getYouTubeVideoId(url);
  if (!videoId) return res.status(400).send('URL YouTube không hợp lệ');

  // Danh sách các máy chủ Invidious API chạy ổn định nhất
  const INVIDIOUS_INSTANCES = [
    'https://invidious.nerdvpn.de',
    'https://invidious.drgns.space',
    'https://inv.us.projectsegfau.lt',
    'https://invidious.privacyredirect.com',
    'https://invidious.io.lol'
  ];

  let videoData = null;

  // Tự động xoay vòng máy chủ nếu có server bị nghẽn
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const response = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(5000) // Giới hạn chờ 5 giây cho mỗi server
      });

      if (response.ok) {
        videoData = await response.json();
        break; // Lấy dữ liệu thành công, thoát vòng lặp
      }
    } catch (e) {
      console.log(`Server Invidious (${instance}) bận, đang chuyển server tiếp theo...`);
    }
  }

  if (!videoData) {
    return res.status(500).send('Tất cả máy chủ phân tích đều bận. Vui lòng bấm tải lại sau vài giây.');
  }

  try {
    const isMp3 = format === 'mp3';
    let targetUrl = '';

    if (isMp3) {
      // Lấy stream Audio có chất lượng Bitrate cao nhất từ adaptiveFormats
      const audioStreams = videoData.adaptiveFormats
        ?.filter(f => f.type && f.type.startsWith('audio/'))
        .sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

      targetUrl = audioStreams?.[0]?.url;
    } else {
      // Lấy stream Video kèm sẵn tiếng từ formatStreams
      const videoStreams = videoData.formatStreams
        ?.sort((a, b) => (parseInt(b.height) || 0) - (parseInt(a.height) || 0));

      targetUrl = videoStreams?.[0]?.url;
    }

    if (targetUrl) {
      // Chuyển hướng người dùng trực tiếp tới link tải của Google CDN
      return res.redirect(targetUrl);
    } else {
      return res.status(500).send('Không tìm thấy đường dẫn tải xuống phù hợp.');
    }
  } catch (err) {
    console.error('Lỗi xử lý file:', err);
    return res.status(500).send('Lỗi máy chủ khi tạo đường dẫn tải.');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server đang chạy tại port ${PORT}`);
});
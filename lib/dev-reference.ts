/**
 * Dữ liệu tra cứu nhanh cho dev: HTTP status, header, method, cổng mạng, MIME, ASCII, entity/ký hiệu
 * và bộ kiểm tra CORS preflight. Thuần dữ liệu + logic (không React).
 */

export interface RefRow {
  /** Khóa ổn định, dùng để deep-link tới dòng. */
  id: string;
  /** Mã nhóm (dùng để lọc/tô màu). */
  cat: string;
  /** Giá trị các cột (đã là chuỗi, sao chép được). */
  cells: string[];
}

export interface RefCategory {
  id: string;
  label: string;
}

export interface RefTable {
  id: string;
  label: string;
  hint: string;
  columns: string[];
  /** Chỉ số các cột in đậm/monospace. */
  mono: number[];
  categories: RefCategory[];
  rows: RefRow[];
}

/** Bỏ dấu tiếng Việt + chữ thường để tìm kiếm không phân biệt dấu. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

/** Lọc dòng: mọi từ khóa (cách nhau bằng khoảng trắng) phải xuất hiện ở đâu đó trong dòng. */
export function filterRows(rows: RefRow[], query: string, cat = ''): RefRow[] {
  const tokens = normalize(query.trim()).split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (cat && r.cat !== cat) return false;
    if (!tokens.length) return true;
    const hay = normalize(r.cells.join(' \u0001 '));
    return tokens.every((t) => hay.includes(t));
  });
}

/* ------------------------------------------------------------------ */
/* HTTP STATUS                                                         */
/* ------------------------------------------------------------------ */

type S = [code: number, name: string, meaning: string, when: string, fix: string];

const STATUS: S[] = [
  [100, 'Continue', 'Server đã nhận phần header, client có thể gửi tiếp body.', 'Client gửi "Expect: 100-continue" trước khi upload body lớn.', 'Thường tự xử lý. Nếu upload bị treo, kiểm tra proxy/server có hỗ trợ Expect không.'],
  [101, 'Switching Protocols', 'Server đồng ý chuyển giao thức theo header Upgrade.', 'Nâng cấp kết nối HTTP lên WebSocket.', 'Nếu WebSocket không lên, kiểm tra reverse proxy có chuyển tiếp Upgrade và Connection chưa.'],
  [102, 'Processing', 'WebDAV (đã lỗi thời): server đang xử lý, chưa có kết quả.', 'Hiếm, chỉ trong WebDAV với yêu cầu chạy lâu.', 'Chờ; không nên dùng trong API mới.'],
  [103, 'Early Hints', 'Gửi sớm các header Link để trình duyệt preload tài nguyên trước khi có phản hồi chính.', 'CDN/server bật Early Hints để tăng tốc tải trang.', 'Không phải lỗi; bật ở CDN (Cloudflare, Fastly) để cải thiện LCP.'],

  [200, 'OK', 'Yêu cầu thành công; body chứa kết quả.', 'GET/POST/PUT thành công thông thường.', 'Không cần làm gì.'],
  [201, 'Created', 'Đã tạo tài nguyên mới, thường kèm header Location trỏ tới nó.', 'POST/PUT tạo bản ghi mới trong REST API.', 'Trả về Location và (tùy chọn) representation của tài nguyên mới.'],
  [202, 'Accepted', 'Đã nhận yêu cầu nhưng chưa xử lý xong (xử lý bất đồng bộ).', 'Job nền, hàng đợi, xử lý video/báo cáo.', 'Trả về URL để client polling trạng thái job.'],
  [203, 'Non-Authoritative Information', 'Nội dung đã bị proxy biến đổi so với bản gốc.', 'Qua proxy/CDN có sửa nội dung.', 'Hiếm gặp; kiểm tra proxy trung gian nếu nội dung khác bản gốc.'],
  [204, 'No Content', 'Thành công nhưng không có body.', 'DELETE hoặc PUT/PATCH thành công không cần trả dữ liệu; preflight CORS.', 'Không được kèm body. Client không nên parse JSON khi nhận 204.'],
  [205, 'Reset Content', 'Thành công, yêu cầu client reset lại form/giao diện.', 'Form nhập liệu cần xóa sau khi gửi (rất hiếm).', 'Ít được hỗ trợ; dùng 204 hoặc 303 cho thực tế.'],
  [206, 'Partial Content', 'Trả về một phần nội dung theo header Range.', 'Tải tiếp file dang dở, tua video/audio, tải song song.', 'Kiểm tra Accept-Ranges, Content-Range. Server phải hỗ trợ Range.'],
  [207, 'Multi-Status', 'WebDAV: body XML chứa nhiều kết quả cho nhiều tài nguyên.', 'WebDAV PROPFIND; một số API batch dùng để trả kết quả từng phần tử.', 'Đọc từng phần tử con để biết thành công/thất bại riêng.'],
  [208, 'Already Reported', 'WebDAV: các thành viên đã được liệt kê ở phần trước của phản hồi.', 'WebDAV với binding, tránh liệt kê lặp.', 'Hiếm, chỉ trong WebDAV.'],
  [226, 'IM Used', 'Server trả về kết quả của một phép delta (RFC 3229).', 'Delta encoding, gần như không dùng.', 'Hiếm; bỏ qua nếu không dùng delta encoding.'],

  [300, 'Multiple Choices', 'Có nhiều lựa chọn biểu diễn cho tài nguyên; client/người dùng chọn.', 'Content negotiation thủ công (hiếm).', 'Chỉ rõ lựa chọn mặc định bằng Location.'],
  [301, 'Moved Permanently', 'Tài nguyên đã chuyển vĩnh viễn sang URL mới (Location).', 'Đổi domain, ép HTTP→HTTPS, đổi cấu trúc URL (giữ SEO).', 'Trình duyệt cache rất lâu. POST có thể bị đổi thành GET; muốn giữ method dùng 308. Tránh vòng lặp redirect.'],
  [302, 'Found', 'Chuyển hướng tạm thời sang Location.', 'Redirect sau đăng nhập, A/B test, link rút gọn.', 'Method có thể bị đổi sang GET; cần giữ method dùng 307. Nếu bị lặp, kiểm tra cookie/session.'],
  [303, 'See Other', 'Lấy kết quả ở URL khác bằng GET.', 'Mẫu Post/Redirect/Get sau khi submit form.', 'Dùng sau POST để tránh gửi lại form khi F5.'],
  [304, 'Not Modified', 'Tài nguyên chưa đổi, dùng bản cache (không có body).', 'Request có điều kiện: If-None-Match (ETag) hoặc If-Modified-Since.', 'Bình thường và có lợi. Nếu muốn tải mới: Ctrl+F5 hoặc đổi tên file (cache busting).'],
  [305, 'Use Proxy', 'Đã lỗi thời: yêu cầu phải truy cập qua proxy.', 'Không còn dùng (vấn đề bảo mật).', 'Bỏ qua.'],
  [306, '(Unused)', 'Mã đã dự trữ trước đây, không còn dùng.', 'Không gặp thực tế.', 'Không dùng.'],
  [307, 'Temporary Redirect', 'Chuyển hướng tạm thời, giữ nguyên method và body.', 'Redirect tạm của API POST/PUT; HSTS internal redirect trong trình duyệt.', 'Dùng thay 302 khi cần giữ method.'],
  [308, 'Permanent Redirect', 'Chuyển hướng vĩnh viễn, giữ nguyên method và body.', 'Đổi URL vĩnh viễn của endpoint POST/PUT.', 'Dùng thay 301 khi cần giữ method.'],

  [400, 'Bad Request', 'Server không hiểu yêu cầu do cú pháp/giá trị sai.', 'JSON hỏng, thiếu tham số, header quá lớn/sai định dạng.', 'Kiểm tra body, Content-Type, tham số; xem thông điệp lỗi trong body. Xóa cookie quá lớn.'],
  [401, 'Unauthorized', 'Chưa xác thực hoặc thông tin đăng nhập sai/hết hạn.', 'Thiếu/sai token, token hết hạn, sai API key.', 'Gửi lại Authorization hợp lệ, làm mới token. Server nên kèm WWW-Authenticate.'],
  [402, 'Payment Required', 'Dành riêng cho thanh toán, chưa chuẩn hóa.', 'Một số API trả khi hết hạn mức/quota hoặc chưa thanh toán (Stripe, v.v.).', 'Kiểm tra gói/billing của dịch vụ.'],
  [403, 'Forbidden', 'Đã xác thực nhưng không có quyền truy cập.', 'Sai quyền, IP bị chặn, WAF chặn, CORS/CSRF token sai, thư mục không cho liệt kê.', 'Kiểm tra phân quyền, quyền file, rule WAF/IP; khác 401 ở chỗ đăng nhập lại cũng không giúp.'],
  [404, 'Not Found', 'Không tìm thấy tài nguyên tại URL này.', 'Sai đường dẫn, file bị xóa, route chưa khai báo; đôi khi dùng để che giấu 403.', 'Kiểm tra URL, chữ hoa/thường, base path, cấu hình rewrite (SPA cần fallback về index.html).'],
  [405, 'Method Not Allowed', 'Method không được phép với tài nguyên này.', 'Gọi POST vào route chỉ cho GET; thiếu cấu hình CORS cho method.', 'Xem header Allow trong phản hồi; sửa method hoặc thêm handler.'],
  [406, 'Not Acceptable', 'Không thể tạo nội dung phù hợp với header Accept*.', 'Client yêu cầu định dạng/ngôn ngữ server không có.', 'Nới lỏng Accept hoặc hỗ trợ thêm định dạng.'],
  [407, 'Proxy Authentication Required', 'Cần xác thực với proxy.', 'Mạng công ty yêu cầu đăng nhập proxy.', 'Cấu hình Proxy-Authorization / biến môi trường HTTP_PROXY có tài khoản.'],
  [408, 'Request Timeout', 'Server chờ quá lâu mà client chưa gửi xong yêu cầu.', 'Mạng chậm, client mở kết nối nhưng không gửi dữ liệu.', 'Thử lại; tăng timeout phía server nếu hợp lý.'],
  [409, 'Conflict', 'Xung đột với trạng thái hiện tại của tài nguyên.', 'Trùng khóa duy nhất (email đã tồn tại), sửa đồng thời (version/ETag lệch).', 'Tải lại dữ liệu mới nhất rồi thử lại; hiển thị lỗi rõ ràng cho người dùng.'],
  [410, 'Gone', 'Tài nguyên đã bị xóa vĩnh viễn và sẽ không quay lại.', 'Gỡ nội dung có chủ ý (báo cho bot xóa khỏi chỉ mục nhanh hơn 404).', 'Dùng khi muốn thông báo dứt khoát; ngược lại dùng 404.'],
  [411, 'Length Required', 'Server yêu cầu header Content-Length.', 'Gửi body mà thiếu Content-Length (một số server cũ).', 'Thêm Content-Length hoặc dùng cách gửi hợp lệ.'],
  [412, 'Precondition Failed', 'Điều kiện trong If-Match/If-Unmodified-Since không thỏa.', 'Optimistic locking: ETag đã đổi từ lúc client đọc.', 'Lấy lại bản mới và gộp thay đổi.'],
  [413, 'Content Too Large', 'Body yêu cầu vượt giới hạn server (trước đây: Payload Too Large).', 'Upload file lớn; Nginx mặc định client_max_body_size 1m.', 'Tăng giới hạn (nginx client_max_body_size, Express limit) hoặc chia nhỏ/dùng upload trực tiếp lên storage.'],
  [414, 'URI Too Long', 'URL dài hơn mức server chấp nhận.', 'Nhét dữ liệu lớn vào query string, vòng lặp redirect nối thêm tham số.', 'Chuyển dữ liệu sang POST body; tăng large_client_header_buffers nếu cần.'],
  [415, 'Unsupported Media Type', 'Server không hỗ trợ định dạng Content-Type của body.', 'Gửi JSON mà thiếu "Content-Type: application/json", hoặc gửi XML vào API JSON.', 'Đặt đúng Content-Type và định dạng body.'],
  [416, 'Range Not Satisfiable', 'Khoảng Range yêu cầu nằm ngoài kích thước tài nguyên.', 'Tiếp tục tải file đã đổi/nhỏ hơn bản cũ.', 'Xóa bản tải dở và tải lại từ đầu; kiểm tra Content-Range: */size.'],
  [417, 'Expectation Failed', 'Server không đáp ứng được giá trị header Expect.', 'Expect: 100-continue bị proxy/server từ chối.', 'Tắt Expect ở client (vd. curl -H "Expect:").'],
  [418, "I'm a teapot", 'Cá tháng Tư RFC 2324 (HTCPCP): máy pha trà từ chối pha cà phê.', 'Dùng đùa hoặc làm mã "từ chối" tùy ý (một số API chống bot dùng).', 'Không phải lỗi chuẩn; đọc tài liệu của dịch vụ đang gọi.'],
  [421, 'Misdirected Request', 'Yêu cầu gửi tới server không thể tạo phản hồi cho host đó.', 'HTTP/2 tái sử dụng kết nối cho nhiều host/chứng chỉ không khớp.', 'Kiểm tra SNI/chứng chỉ wildcard, cấu hình vhost; client sẽ mở kết nối mới.'],
  [422, 'Unprocessable Content', 'Cú pháp đúng nhưng nội dung không hợp lệ về ngữ nghĩa.', 'Lỗi validate dữ liệu (REST API, Rails, Laravel, FastAPI).', 'Đọc chi tiết lỗi từng trường trong body và sửa dữ liệu.'],
  [423, 'Locked', 'WebDAV: tài nguyên đang bị khóa.', 'WebDAV sửa file đang bị khóa.', 'Mở khóa hoặc chờ.'],
  [424, 'Failed Dependency', 'WebDAV: thất bại do yêu cầu phụ thuộc trước đó thất bại.', 'Trong PROPPATCH/batch WebDAV.', 'Xử lý lỗi gốc trước.'],
  [425, 'Too Early', 'Server từ chối xử lý yêu cầu có thể bị phát lại (TLS early data).', 'TLS 1.3 0-RTT (early data).', 'Client thử lại sau khi bắt tay TLS hoàn tất.'],
  [426, 'Upgrade Required', 'Phải nâng cấp giao thức (header Upgrade) mới dùng được.', 'Server chỉ chấp nhận TLS/HTTP/2 hoặc WebSocket.', 'Đổi sang giao thức được yêu cầu.'],
  [428, 'Precondition Required', 'Server yêu cầu yêu cầu phải có điều kiện (If-Match).', 'Ngăn lost-update khi sửa đồng thời.', 'Gửi kèm If-Match với ETag hiện tại.'],
  [429, 'Too Many Requests', 'Gửi quá nhiều yêu cầu trong khoảng thời gian (rate limit).', 'Vượt hạn mức API, bị chống brute-force/bot.', 'Đọc Retry-After; áp dụng exponential backoff, giảm tần suất, cache kết quả.'],
  [431, 'Request Header Fields Too Large', 'Header (hoặc 1 header) quá lớn.', 'Cookie phình to, token JWT quá dài.', 'Xóa cookie thừa, rút gọn token; tăng giới hạn header của server nếu cần.'],
  [451, 'Unavailable For Legal Reasons', 'Nội dung bị chặn vì lý do pháp lý (tham chiếu Fahrenheit 451).', 'Bị chặn theo lệnh tòa/quy định vùng.', 'Không do lỗi kỹ thuật; xem header Link rel="blocked-by".'],

  [500, 'Internal Server Error', 'Lỗi chung phía server, không rõ chi tiết.', 'Exception chưa bắt, cấu hình sai, lỗi code, DB hỏng.', 'Xem log server và stack trace; tái hiện bằng cùng dữ liệu đầu vào.'],
  [501, 'Not Implemented', 'Server chưa hỗ trợ chức năng/method được yêu cầu.', 'Method lạ (vd. PATCH trên server cũ).', 'Dùng method được hỗ trợ hoặc nâng cấp server.'],
  [502, 'Bad Gateway', 'Gateway/proxy nhận phản hồi không hợp lệ từ server phía sau.', 'Nginx không nói chuyện được với app (crash, sai port, socket).', 'Kiểm tra app upstream đang chạy, port/socket đúng, log nginx error.log.'],
  [503, 'Service Unavailable', 'Server tạm thời không phục vụ được (quá tải/bảo trì).', 'Đang deploy, bảo trì, quá tải, hết worker.', 'Chờ và thử lại (đọc Retry-After); mở rộng tài nguyên, kiểm tra health check.'],
  [504, 'Gateway Timeout', 'Gateway/proxy chờ upstream quá thời gian.', 'Truy vấn/API upstream chạy chậm hơn timeout của proxy.', 'Tối ưu tác vụ chậm hoặc tăng proxy_read_timeout; chuyển sang xử lý bất đồng bộ.'],
  [505, 'HTTP Version Not Supported', 'Phiên bản HTTP không được hỗ trợ.', 'Client dùng HTTP quá cũ/mới so với server.', 'Dùng HTTP/1.1 hoặc phiên bản hỗ trợ.'],
  [506, 'Variant Also Negotiates', 'Lỗi cấu hình content negotiation vòng lặp.', 'Rất hiếm.', 'Sửa cấu hình negotiation trên server.'],
  [507, 'Insufficient Storage', 'WebDAV: server hết dung lượng để hoàn tất yêu cầu.', 'Ổ đĩa đầy khi lưu file.', 'Giải phóng dung lượng.'],
  [508, 'Loop Detected', 'WebDAV: phát hiện vòng lặp khi xử lý.', 'Cấu trúc binding vòng tròn.', 'Sửa cấu trúc tài nguyên.'],
  [510, 'Not Extended', 'Cần thêm phần mở rộng (RFC 2774, lỗi thời).', 'Gần như không gặp.', 'Bỏ qua.'],
  [511, 'Network Authentication Required', 'Cần đăng nhập vào mạng trước khi truy cập (captive portal).', 'Wi-Fi sân bay/khách sạn chặn cho tới khi đăng nhập.', 'Mở trình duyệt, đăng nhập cổng Wi-Fi.'],

  [419, 'Page Expired (Laravel)', 'Không chuẩn: phiên/CSRF token hết hạn trong Laravel.', 'Gửi form khi session hết hạn hoặc thiếu @csrf.', 'Tải lại trang để lấy token mới; thêm @csrf vào form.'],
  [444, 'No Response (nginx)', 'Không chuẩn: nginx đóng kết nối mà không trả phản hồi.', 'Cấu hình "return 444;" để chặn bot/scan.', 'Chủ ý của quản trị; client chỉ thấy kết nối bị ngắt.'],
  [499, 'Client Closed Request (nginx)', 'Không chuẩn: client đóng kết nối trước khi nginx trả lời xong.', 'Người dùng hủy request/đóng tab, client timeout ngắn hơn server xử lý.', 'Kiểm tra timeout phía client và tối ưu thời gian xử lý. Chỉ có trong log nginx.'],
  [520, 'Web Server Returned an Unknown Error (Cloudflare)', 'Cloudflare: origin trả phản hồi trống/không hiểu được.', 'Origin crash, header quá lớn, kết nối bị reset.', 'Xem log origin; kiểm tra firewall, header Set-Cookie quá lớn.'],
  [521, 'Web Server Is Down (Cloudflare)', 'Cloudflare: origin từ chối kết nối.', 'Web server tắt hoặc chặn IP Cloudflare.', 'Bật lại server; cho phép dải IP Cloudflare qua firewall, mở port 80/443.'],
  [522, 'Connection Timed Out (Cloudflare)', 'Cloudflare: không bắt tay TCP được với origin kịp thời.', 'Origin quá tải hoặc firewall chặn IP Cloudflare.', 'Kiểm tra tải server, firewall/ACL, đúng IP origin trong DNS.'],
  [523, 'Origin Is Unreachable (Cloudflare)', 'Cloudflare: không tới được origin.', 'DNS trỏ sai IP, lỗi routing mạng.', 'Sửa bản ghi DNS và kiểm tra routing tới origin.'],
  [524, 'A Timeout Occurred (Cloudflare)', 'Cloudflare: kết nối được nhưng origin không trả phản hồi trong ~100 giây.', 'Request chạy rất lâu (export, báo cáo).', 'Tối ưu hoặc chuyển sang xử lý nền; trả 202 và polling.'],
  [525, 'SSL Handshake Failed (Cloudflare)', 'Cloudflare: bắt tay SSL/TLS với origin thất bại.', 'Origin không bật HTTPS ở chế độ Full, sai cipher/phiên bản TLS.', 'Cài chứng chỉ trên origin, kiểm tra cipher và SNI.'],
  [526, 'Invalid SSL Certificate (Cloudflare)', 'Cloudflare: chứng chỉ origin không hợp lệ (chế độ Full strict).', 'Chứng chỉ origin hết hạn, tự ký hoặc sai tên miền.', 'Dùng chứng chỉ hợp lệ hoặc Cloudflare Origin CA.'],
  [527, 'Railgun Error (Cloudflare)', 'Cloudflare: lỗi kết nối Railgun (dịch vụ đã ngừng).', 'Hiếm, sản phẩm đã bị loại bỏ.', 'Tắt Railgun.'],
  [530, 'Origin DNS Error (Cloudflare)', 'Cloudflare: thường đi kèm lỗi 1xxx (vd. 1016 origin DNS không phân giải).', 'Domain origin không phân giải; tài khoản/zone bị cấu hình sai.', 'Đọc mã lỗi 1xxx trong body để biết nguyên nhân cụ thể.'],
];

export const STATUS_CATEGORIES: RefCategory[] = [
  { id: '1xx', label: '1xx Thông tin' },
  { id: '2xx', label: '2xx Thành công' },
  { id: '3xx', label: '3xx Chuyển hướng' },
  { id: '4xx', label: '4xx Lỗi client' },
  { id: '5xx', label: '5xx Lỗi server' },
];

export function statusCategory(code: number): string {
  return `${Math.floor(code / 100)}xx`;
}

export const STATUS_ROWS: RefRow[] = [...STATUS].sort((a, b) => a[0] - b[0]).map(([code, name, meaning, when, fix]) => ({
  id: String(code),
  cat: statusCategory(code),
  cells: [String(code), name, meaning, when, fix],
}));

export function lookupStatus(code: number): RefRow | undefined {
  return STATUS_ROWS.find((r) => r.id === String(code));
}

/* ------------------------------------------------------------------ */
/* HTTP HEADERS                                                        */
/* ------------------------------------------------------------------ */

type H = [name: string, kind: 'Request' | 'Response' | 'Cả hai', group: string, desc: string, example: string, when: string];

const HEADERS: H[] = [
  ['Content-Type', 'Cả hai', 'Nội dung', 'Kiểu media (MIME) của body, có thể kèm charset/boundary.', 'application/json; charset=utf-8', 'Gửi JSON/form lên API hoặc báo kiểu file tải về; sai kiểu gây 415.'],
  ['Content-Length', 'Cả hai', 'Nội dung', 'Kích thước body tính bằng byte.', '348', 'Upload; thiếu có thể gây 411, sai làm treo hoặc cắt cụt kết nối.'],
  ['Content-Encoding', 'Cả hai', 'Nội dung', 'Thuật toán nén đã áp dụng cho body.', 'gzip', 'Nén phản hồi (gzip, br, zstd) để giảm dung lượng.'],
  ['Content-Language', 'Cả hai', 'Nội dung', 'Ngôn ngữ của nội dung.', 'vi', 'Trang đa ngôn ngữ.'],
  ['Content-Disposition', 'Response', 'Nội dung', 'Hiển thị inline hay tải về (attachment) và tên file gợi ý.', 'attachment; filename="bao-cao.pdf"', 'Ép trình duyệt tải file thay vì mở.'],
  ['Content-Range', 'Response', 'Nội dung', 'Khoảng byte của phần nội dung được trả (206).', 'bytes 0-1023/4096', 'Tải tiếp hoặc streaming video.'],
  ['Accept', 'Request', 'Nội dung', 'Các kiểu media client chấp nhận (kèm trọng số q).', 'application/json, text/plain;q=0.8', 'Content negotiation; sai có thể bị 406.'],
  ['Accept-Encoding', 'Request', 'Nội dung', 'Các thuật toán nén client hỗ trợ.', 'gzip, deflate, br, zstd', 'Trình duyệt tự gửi để server chọn nén.'],
  ['Accept-Language', 'Request', 'Nội dung', 'Ngôn ngữ ưu tiên của người dùng.', 'vi-VN,vi;q=0.9,en;q=0.8', 'Chọn ngôn ngữ giao diện tự động.'],
  ['Accept-Ranges', 'Response', 'Nội dung', 'Server có hỗ trợ yêu cầu Range hay không.', 'bytes', 'Cho phép resume download/tua video.'],
  ['Range', 'Request', 'Nội dung', 'Yêu cầu một phần của tài nguyên.', 'bytes=0-1023', 'Tải tiếp file, tua video.'],
  ['If-Range', 'Request', 'Điều kiện', 'Chỉ trả Range nếu tài nguyên chưa đổi, ngược lại trả toàn bộ.', '"33a64df551425fcc55e4d42a148795d9f25f89d4"', 'Resume download an toàn.'],
  ['Transfer-Encoding', 'Cả hai', 'Kết nối', 'Cách truyền body trong HTTP/1.1.', 'chunked', 'Stream phản hồi không biết trước độ dài.'],
  ['Host', 'Request', 'Kết nối', 'Tên miền (và cổng) của server đích; bắt buộc trong HTTP/1.1.', 'api.example.com', 'Virtual host; sai/ thiếu gây 400.'],
  ['User-Agent', 'Request', 'Kết nối', 'Thông tin trình duyệt/ứng dụng client.', 'Mozilla/5.0 (X11; Linux x86_64) ...', 'Log, phát hiện bot, một số API yêu cầu bắt buộc (GitHub).'],
  ['Referer', 'Request', 'Kết nối', 'URL trang dẫn tới yêu cầu (chính tả sai "Referer" là chuẩn).', 'https://example.com/trang-truoc', 'Thống kê nguồn truy cập, chống hotlink.'],
  ['Origin', 'Request', 'CORS', 'Nguồn (scheme + host + port) khởi tạo yêu cầu cross-origin hoặc POST.', 'https://app.example.com', 'Server dùng để kiểm tra CORS/CSRF.'],
  ['Location', 'Response', 'Chuyển hướng', 'URL để chuyển hướng (3xx) hoặc URL tài nguyên mới (201).', '/dang-nhap', 'Redirect hoặc trả URL sau khi tạo.'],
  ['Link', 'Response', 'Chuyển hướng', 'Liên kết liên quan: preload, phân trang API, canonical.', '</style.css>; rel=preload; as=style', 'Early Hints, phân trang kiểu GitHub (rel="next").'],
  ['Retry-After', 'Response', 'Chuyển hướng', 'Thời gian chờ trước khi thử lại (giây hoặc ngày giờ).', '120', 'Đi kèm 429, 503.'],
  ['Date', 'Cả hai', 'Chung', 'Thời điểm tạo thông điệp (giờ GMT).', 'Wed, 21 Oct 2026 07:28:00 GMT', 'Tính tuổi cache, debug lệch giờ.'],
  ['Server', 'Response', 'Chung', 'Phần mềm server (nên ẩn phiên bản).', 'nginx', 'Chẩn đoán; nên giảm chi tiết để hạn chế lộ thông tin.'],
  ['Allow', 'Response', 'Chung', 'Các method được phép với tài nguyên.', 'GET, HEAD, POST', 'Đi kèm 405.'],
  ['Connection', 'Cả hai', 'Kết nối', 'Điều khiển kết nối (keep-alive, close, Upgrade).', 'keep-alive', 'WebSocket cần "Upgrade".'],
  ['Keep-Alive', 'Cả hai', 'Kết nối', 'Tham số giữ kết nối (HTTP/1.1).', 'timeout=5, max=1000', 'Tinh chỉnh tái sử dụng kết nối.'],
  ['Upgrade', 'Cả hai', 'Kết nối', 'Đề nghị đổi giao thức.', 'websocket', 'Mở WebSocket.'],
  ['Via', 'Cả hai', 'Proxy', 'Các proxy/gateway thông điệp đã đi qua.', '1.1 vegur', 'Debug chuỗi proxy.'],
  ['X-Forwarded-For', 'Request', 'Proxy', 'Chuỗi IP client gốc và các proxy (không chuẩn nhưng phổ biến).', '203.0.113.7, 70.41.3.18', 'Lấy IP thật sau load balancer; chỉ tin khi proxy đáng tin.'],
  ['X-Forwarded-Proto', 'Request', 'Proxy', 'Giao thức gốc client dùng (http/https).', 'https', 'App sau proxy biết yêu cầu gốc là HTTPS để tạo URL/cookie Secure.'],
  ['X-Forwarded-Host', 'Request', 'Proxy', 'Host gốc client yêu cầu.', 'www.example.com', 'App sau proxy tạo đúng URL tuyệt đối.'],
  ['Forwarded', 'Request', 'Proxy', 'Phiên bản chuẩn (RFC 7239) thay cho X-Forwarded-*.', 'for=203.0.113.7;proto=https;host=example.com', 'Thông tin client gốc theo chuẩn.'],
  ['X-Request-ID', 'Cả hai', 'Proxy', 'ID duy nhất để truy vết yêu cầu (không chuẩn).', '8c1b2a0e-4d6f-4a8b-9f13-2e0b7c9d41aa', 'Log phân tán, tìm lỗi xuyên nhiều dịch vụ.'],
  ['Authorization', 'Request', 'Xác thực', 'Thông tin xác thực gửi tới server.', 'Bearer eyJhbGciOi...', 'API có bảo vệ; cross-origin phải liệt kê trong Access-Control-Allow-Headers.'],
  ['WWW-Authenticate', 'Response', 'Xác thực', 'Cách xác thực server yêu cầu (đi kèm 401).', 'Bearer realm="api", error="invalid_token"', 'Phản hồi 401.'],
  ['Proxy-Authorization', 'Request', 'Xác thực', 'Thông tin xác thực với proxy.', 'Basic dXNlcjpwYXNz', 'Đi kèm 407.'],
  ['Proxy-Authenticate', 'Response', 'Xác thực', 'Cách xác thực proxy yêu cầu.', 'Basic realm="proxy"', 'Phản hồi 407.'],
  ['Cookie', 'Request', 'Cookie', 'Các cookie trình duyệt gửi lên server.', 'sid=abc123; theme=dark', 'Phiên đăng nhập; quá lớn gây 431.'],
  ['Set-Cookie', 'Response', 'Cookie', 'Đặt cookie kèm thuộc tính.', 'sid=abc123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600', 'Đăng nhập; luôn dùng HttpOnly, Secure, SameSite cho cookie phiên.'],
  ['Cache-Control', 'Cả hai', 'Cache', 'Chỉ thị cách cache (xem bảng directive bên dưới).', 'public, max-age=31536000, immutable', 'Cache asset tĩnh; no-store cho dữ liệu nhạy cảm.'],
  ['ETag', 'Response', 'Cache', 'Định danh phiên bản nội dung, dùng cho request có điều kiện.', '"33a64df5"', 'Cho phép 304 Not Modified.'],
  ['If-None-Match', 'Request', 'Điều kiện', 'Chỉ trả nội dung nếu ETag khác; nếu giống trả 304.', '"33a64df5"', 'Trình duyệt tự gửi khi có cache.'],
  ['If-Match', 'Request', 'Điều kiện', 'Chỉ thực hiện nếu ETag khớp (optimistic locking).', '"33a64df5"', 'PUT/PATCH tránh ghi đè (412).'],
  ['If-Modified-Since', 'Request', 'Điều kiện', 'Chỉ trả nội dung nếu sửa đổi sau thời điểm này.', 'Wed, 21 Oct 2026 07:28:00 GMT', 'Cache validation theo thời gian.'],
  ['If-Unmodified-Since', 'Request', 'Điều kiện', 'Chỉ thực hiện nếu chưa sửa đổi sau thời điểm này.', 'Wed, 21 Oct 2026 07:28:00 GMT', 'Ghi an toàn / resume.'],
  ['Last-Modified', 'Response', 'Cache', 'Thời điểm sửa đổi cuối của tài nguyên.', 'Wed, 21 Oct 2026 07:28:00 GMT', 'Validator yếu hơn ETag.'],
  ['Expires', 'Response', 'Cache', 'Thời điểm hết hạn cache (cũ, Cache-Control: max-age ưu tiên hơn).', 'Thu, 01 Dec 2026 16:00:00 GMT', 'Tương thích hệ thống cũ.'],
  ['Age', 'Response', 'Cache', 'Số giây tài nguyên đã nằm trong cache proxy/CDN.', '24', 'Debug CDN có trúng cache hay không.'],
  ['Vary', 'Response', 'Cache', 'Các header request ảnh hưởng đến nội dung trả về; cache phải tách theo đó.', 'Accept-Encoding, Origin', 'Phản hồi đổi theo nén/Origin (CORS) hoặc ngôn ngữ.'],
  ['Pragma', 'Cả hai', 'Cache', 'Header HTTP/1.0 cũ; "no-cache" tương đương Cache-Control.', 'no-cache', 'Tương thích hệ thống rất cũ.'],
  ['Clear-Site-Data', 'Response', 'Cache', 'Yêu cầu trình duyệt xóa dữ liệu site (cache, cookie, storage).', '"cache", "cookies", "storage"', 'Đăng xuất hoàn toàn.'],
  ['Access-Control-Allow-Origin', 'Response', 'CORS', 'Origin được phép đọc phản hồi (một origin cụ thể hoặc *).', 'https://app.example.com', 'API cho SPA khác domain; không dùng * khi có credentials.'],
  ['Access-Control-Allow-Methods', 'Response', 'CORS', 'Các method được phép (trả lời preflight).', 'GET, POST, PUT, DELETE, OPTIONS', 'Phản hồi OPTIONS.'],
  ['Access-Control-Allow-Headers', 'Response', 'CORS', 'Các header request được phép (trả lời preflight).', 'Content-Type, Authorization', 'Gửi JSON hoặc Authorization cross-origin.'],
  ['Access-Control-Allow-Credentials', 'Response', 'CORS', 'Cho phép gửi cookie/xác thực cross-origin ("true").', 'true', 'fetch với credentials: "include".'],
  ['Access-Control-Expose-Headers', 'Response', 'CORS', 'Header phản hồi mà JS cross-origin được phép đọc.', 'X-Total-Count, ETag', 'JS cần đọc header tùy chỉnh (mặc định chỉ đọc 7 header an toàn).'],
  ['Access-Control-Max-Age', 'Response', 'CORS', 'Số giây trình duyệt cache kết quả preflight.', '600', 'Giảm số lần OPTIONS (trình duyệt có thể giới hạn: Chrome 2 giờ, Firefox 24 giờ).'],
  ['Access-Control-Request-Method', 'Request', 'CORS', 'Method thật mà preflight hỏi.', 'PUT', 'Trình duyệt tự gửi trong OPTIONS.'],
  ['Access-Control-Request-Headers', 'Request', 'CORS', 'Các header thật mà preflight hỏi.', 'authorization, content-type', 'Trình duyệt tự gửi trong OPTIONS.'],
  ['Timing-Allow-Origin', 'Response', 'CORS', 'Origin được đọc Resource Timing chi tiết.', '*', 'Đo hiệu năng tài nguyên cross-origin.'],
  ['Content-Security-Policy', 'Response', 'Bảo mật', 'Chính sách nguồn tài nguyên được tải/chạy (chống XSS).', "default-src 'self'; script-src 'self' https://cdn.example.com; object-src 'none'", 'Cứng hóa chống XSS; triển khai dần bằng Report-Only.'],
  ['Content-Security-Policy-Report-Only', 'Response', 'Bảo mật', 'Như CSP nhưng chỉ báo cáo, không chặn.', "default-src 'self'; report-to csp-endpoint", 'Thử CSP trước khi bật chặn thật.'],
  ['Strict-Transport-Security', 'Response', 'Bảo mật', 'HSTS: buộc trình duyệt luôn dùng HTTPS với domain này.', 'max-age=63072000; includeSubDomains; preload', 'Chống SSL strip; chỉ gửi trên HTTPS.'],
  ['X-Content-Type-Options', 'Response', 'Bảo mật', 'Cấm trình duyệt đoán MIME (MIME sniffing).', 'nosniff', 'Chặn tấn công qua sai Content-Type.'],
  ['X-Frame-Options', 'Response', 'Bảo mật', 'Cấm/ cho phép nhúng trang trong iframe (cũ; ưu tiên CSP frame-ancestors).', 'DENY', 'Chống clickjacking.'],
  ['Referrer-Policy', 'Response', 'Bảo mật', 'Mức thông tin Referer gửi đi.', 'strict-origin-when-cross-origin', 'Bảo vệ URL nhạy cảm khi click link ra ngoài.'],
  ['Permissions-Policy', 'Response', 'Bảo mật', 'Bật/tắt tính năng trình duyệt (camera, mic, geolocation) cho trang và iframe.', 'camera=(), microphone=(), geolocation=(self)', 'Giảm bề mặt tấn công của trang nhúng.'],
  ['Cross-Origin-Opener-Policy', 'Response', 'Bảo mật', 'COOP: cô lập browsing context khỏi cửa sổ cross-origin.', 'same-origin', 'Bắt buộc (cùng COEP) để dùng SharedArrayBuffer.'],
  ['Cross-Origin-Embedder-Policy', 'Response', 'Bảo mật', 'COEP: chỉ nhúng tài nguyên cross-origin đã cho phép.', 'require-corp', 'Cross-origin isolation.'],
  ['Cross-Origin-Resource-Policy', 'Response', 'Bảo mật', 'CORP: ai được nhúng tài nguyên này.', 'same-site', 'Chống rò rỉ tài nguyên qua Spectre.'],
  ['X-XSS-Protection', 'Response', 'Bảo mật', 'Đã lỗi thời: bộ lọc XSS cũ của trình duyệt. Nên bỏ hoặc đặt 0.', '0', 'Chỉ thấy ở hệ thống cũ; dùng CSP thay thế.'],
  ['Sec-Fetch-Site', 'Request', 'Bảo mật', 'Trình duyệt báo mối quan hệ giữa origin gửi và đích (cross-site/same-origin/...).', 'same-origin', 'Server lọc yêu cầu đáng ngờ (chống CSRF).'],
  ['Sec-Fetch-Mode', 'Request', 'Bảo mật', 'Chế độ yêu cầu (cors, navigate, no-cors...).', 'cors', 'Phân loại yêu cầu ở server.'],
  ['Sec-Fetch-Dest', 'Request', 'Bảo mật', 'Đích sử dụng tài nguyên (document, script, image...).', 'document', 'Chặn dùng sai ngữ cảnh.'],
  ['Sec-WebSocket-Key', 'Request', 'WebSocket', 'Khóa ngẫu nhiên base64 trong handshake WebSocket.', 'dGhlIHNhbXBsZSBub25jZQ==', 'Mở WebSocket (server trả Sec-WebSocket-Accept).'],
  ['Sec-WebSocket-Accept', 'Response', 'WebSocket', 'Giá trị băm xác nhận từ Sec-WebSocket-Key.', 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=', 'Trả lời 101 Switching Protocols.'],
  ['Alt-Svc', 'Response', 'Kết nối', 'Quảng bá dịch vụ thay thế (vd. HTTP/3).', 'h3=":443"; ma=86400', 'Bật HTTP/3 (QUIC).'],
  ['Server-Timing', 'Response', 'Chung', 'Số liệu thời gian xử lý phía server hiện trong DevTools.', 'db;dur=53, app;dur=47.2', 'Đo hiệu năng backend.'],
  ['Idempotency-Key', 'Request', 'Chung', 'Khóa để thử lại POST an toàn (dự thảo IETF; Stripe và nhiều API dùng).', '8e03978e-40d5-43e8-bc93-6894a57f9324', 'Tránh trừ tiền hai lần khi retry.'],
  ['X-HTTP-Method-Override', 'Request', 'Chung', 'Không chuẩn: đánh lừa method thật khi client/proxy chỉ cho POST.', 'PUT', 'Hệ thống cũ chặn PUT/DELETE.'],
];

const CACHE_DIRECTIVES: [string, 'Request' | 'Response' | 'Cả hai', string, string, string][] = [
  ['max-age', 'Cả hai', 'Số giây tài nguyên còn "tươi" trong mọi cache.', 'max-age=3600', 'Cache file tĩnh, API ít đổi.'],
  ['s-maxage', 'Response', 'Như max-age nhưng chỉ cho cache dùng chung (CDN/proxy), ghi đè max-age ở đó.', 's-maxage=600', 'CDN cache lâu hơn trình duyệt.'],
  ['no-cache', 'Cả hai', 'Được lưu cache nhưng PHẢI xác thực lại với server (ETag) trước khi dùng.', 'no-cache', 'HTML luôn phải kiểm tra bản mới.'],
  ['no-store', 'Cả hai', 'Không được lưu cache ở bất cứ đâu.', 'no-store', 'Dữ liệu nhạy cảm: ngân hàng, thông tin cá nhân.'],
  ['public', 'Response', 'Cho phép mọi cache (kể cả CDN) lưu, kể cả phản hồi có Authorization.', 'public, max-age=86400', 'Tài nguyên dùng chung.'],
  ['private', 'Response', 'Chỉ cache của trình duyệt người dùng được lưu, CDN không lưu.', 'private, max-age=60', 'Dữ liệu riêng của từng người dùng.'],
  ['must-revalidate', 'Response', 'Khi đã hết hạn, bắt buộc xác thực lại; không dùng bản cũ (cả khi mất mạng).', 'max-age=300, must-revalidate', 'Cần dữ liệu chắc chắn đúng sau khi hết hạn.'],
  ['proxy-revalidate', 'Response', 'Như must-revalidate nhưng chỉ cho cache dùng chung.', 'proxy-revalidate', 'Hiếm; điều khiển riêng CDN.'],
  ['immutable', 'Response', 'Nội dung không bao giờ đổi trong thời hạn max-age; không cần xác thực lại khi reload.', 'public, max-age=31536000, immutable', 'File build có hash trong tên (app.3f9a1c.js).'],
  ['stale-while-revalidate', 'Response', 'Cho phép dùng bản cũ trong N giây trong khi tải bản mới ngầm.', 'max-age=60, stale-while-revalidate=600', 'Trải nghiệm nhanh mà vẫn cập nhật.'],
  ['stale-if-error', 'Response', 'Cho phép dùng bản cũ trong N giây nếu server lỗi.', 'max-age=60, stale-if-error=86400', 'Chịu lỗi khi origin sập.'],
  ['no-transform', 'Cả hai', 'Cấm proxy biến đổi nội dung (nén lại ảnh, minify).', 'no-transform', 'Nội dung phải giữ nguyên từng byte.'],
  ['max-stale', 'Request', 'Client chấp nhận bản đã hết hạn tối đa N giây.', 'max-stale=60', 'Client ưu tiên tốc độ hơn độ tươi.'],
  ['min-fresh', 'Request', 'Client chỉ nhận bản còn tươi thêm ít nhất N giây.', 'min-fresh=30', 'Cần dữ liệu còn hiệu lực lâu hơn.'],
  ['only-if-cached', 'Request', 'Chỉ lấy từ cache, không gọi origin; không có thì 504.', 'only-if-cached', 'Chế độ offline.'],
];

export const HEADER_CATEGORIES: RefCategory[] = [
  { id: 'Nội dung', label: 'Nội dung' },
  { id: 'Cache', label: 'Cache' },
  { id: 'Điều kiện', label: 'Điều kiện' },
  { id: 'CORS', label: 'CORS' },
  { id: 'Bảo mật', label: 'Bảo mật' },
  { id: 'Xác thực', label: 'Xác thực' },
  { id: 'Cookie', label: 'Cookie' },
  { id: 'Kết nối', label: 'Kết nối' },
  { id: 'Proxy', label: 'Proxy' },
  { id: 'Chuyển hướng', label: 'Chuyển hướng' },
  { id: 'WebSocket', label: 'WebSocket' },
  { id: 'Chung', label: 'Chung' },
  { id: 'Cache-Control directive', label: 'Cache-Control directive' },
];

export const HEADER_ROWS: RefRow[] = [
  ...HEADERS.map(([name, kind, group, desc, example, when]) => ({
    id: name.toLowerCase(),
    cat: group,
    cells: [name, kind, desc, example, when],
  })),
  ...CACHE_DIRECTIVES.map(([name, kind, desc, example, when]) => ({
    id: `cc-${name}`,
    cat: 'Cache-Control directive',
    cells: [name, kind, `Cache-Control: ${desc}`, example, when],
  })),
];

/* ------------------------------------------------------------------ */
/* HTTP METHODS                                                        */
/* ------------------------------------------------------------------ */

type M = [method: string, meaning: string, safe: string, idem: string, cache: string, reqBody: string, resBody: string, when: string];

const METHODS: M[] = [
  ['GET', 'Lấy biểu diễn của tài nguyên.', 'Có', 'Có', 'Có', 'Không (không có ngữ nghĩa xác định)', 'Có', 'Đọc dữ liệu, tải trang; không được thay đổi trạng thái server.'],
  ['HEAD', 'Giống GET nhưng chỉ trả header, không có body.', 'Có', 'Có', 'Có', 'Không', 'Không', 'Kiểm tra tài nguyên tồn tại, kích thước, ETag mà không tải về.'],
  ['POST', 'Gửi dữ liệu để xử lý, thường là tạo mới.', 'Không', 'Không', 'Chỉ khi có thông tin freshness rõ ràng', 'Có', 'Có', 'Tạo bản ghi, submit form, hành động không idempotent; thử lại có thể tạo trùng.'],
  ['PUT', 'Thay thế toàn bộ tài nguyên bằng body.', 'Không', 'Có', 'Không', 'Có', 'Có thể', 'Cập nhật cả bản ghi hoặc tạo tại URL xác định; gọi lại cho cùng kết quả.'],
  ['PATCH', 'Cập nhật một phần tài nguyên.', 'Không', 'Không bảo đảm (tùy cách thiết kế)', 'Chỉ khi có thông tin freshness rõ ràng', 'Có', 'Có thể', 'Sửa một vài trường, vd. JSON Patch/Merge Patch. Là method phân biệt hoa thường: "patch" sai.'],
  ['DELETE', 'Xóa tài nguyên.', 'Không', 'Có', 'Không', 'Có thể (không có ngữ nghĩa xác định)', 'Có thể', 'Xóa bản ghi; gọi lại lần hai thường trả 404 nhưng trạng thái cuối giống nhau.'],
  ['OPTIONS', 'Hỏi các tùy chọn giao tiếp khả dụng của tài nguyên.', 'Có', 'Có', 'Không', 'Có thể', 'Có thể', 'Preflight CORS; xem header Allow.'],
  ['TRACE', 'Trả lại nguyên văn yêu cầu nhận được (loopback chẩn đoán).', 'Có', 'Có', 'Không', 'Không', 'Không', 'Debug proxy; nên tắt vì nguy cơ lộ cookie (Cross-Site Tracing).'],
  ['CONNECT', 'Thiết lập tunnel TCP tới server đích qua proxy.', 'Không', 'Không', 'Không', 'Không', 'Có (chỉ trạng thái, sau đó là tunnel)', 'Đi HTTPS qua forward proxy.'],
];

export const METHOD_ROWS: RefRow[] = METHODS.map((m) => ({
  id: m[0].toLowerCase(),
  cat: '',
  cells: m,
}));

/* ------------------------------------------------------------------ */
/* PORTS                                                               */
/* ------------------------------------------------------------------ */

type P = [port: number, proto: string, service: string, desc: string, when: string, group: string];

const PORTS: P[] = [
  [20, 'TCP', 'FTP data', 'Kênh dữ liệu FTP (chế độ active).', 'Chuyển file bằng FTP cũ.', 'Mạng & hệ thống'],
  [21, 'TCP', 'FTP', 'Kênh điều khiển FTP.', 'Deploy/upload bằng FTP; nên thay bằng SFTP.', 'Mạng & hệ thống'],
  [22, 'TCP', 'SSH / SFTP / SCP', 'Đăng nhập từ xa an toàn, truyền file, git qua SSH.', 'Vào server, git clone git@...; firewall chặn gây "Connection timed out".', 'Mạng & hệ thống'],
  [23, 'TCP', 'Telnet', 'Đăng nhập từ xa không mã hóa.', 'Thiết bị mạng cũ; không dùng trên Internet.', 'Mạng & hệ thống'],
  [25, 'TCP', 'SMTP', 'Gửi mail giữa các máy chủ mail.', 'Nhà cung cấp cloud thường chặn outbound 25.', 'Mạng & hệ thống'],
  [53, 'TCP/UDP', 'DNS', 'Phân giải tên miền (UDP thường, TCP khi gói lớn/zone transfer).', 'Debug dig/nslookup; dựng DNS server.', 'Mạng & hệ thống'],
  [67, 'UDP', 'DHCP (server)', 'Cấp phát địa chỉ IP tự động (server lắng nghe cổng 67, client 68).', 'Mạng LAN, container networking.', 'Mạng & hệ thống'],
  [69, 'UDP', 'TFTP', 'Truyền file đơn giản, không xác thực.', 'Boot PXE, cập nhật firmware thiết bị.', 'Mạng & hệ thống'],
  [80, 'TCP', 'HTTP', 'Web không mã hóa.', 'Mặc định web; thường redirect sang 443.', 'Web'],
  [110, 'TCP', 'POP3', 'Nhận mail (không mã hóa).', 'Client mail cũ; dùng 995 (POP3S).', 'Mạng & hệ thống'],
  [123, 'UDP', 'NTP', 'Đồng bộ thời gian.', 'Lệch giờ làm token/TLS lỗi; chrony/ntpd.', 'Mạng & hệ thống'],
  [143, 'TCP', 'IMAP', 'Nhận mail, đồng bộ hộp thư (không mã hóa/STARTTLS).', 'Client mail; dùng 993 (IMAPS).', 'Mạng & hệ thống'],
  [161, 'UDP', 'SNMP', 'Giám sát thiết bị mạng.', 'Monitoring switch/router.', 'Mạng & hệ thống'],
  [389, 'TCP/UDP', 'LDAP', 'Thư mục người dùng (Active Directory, OpenLDAP).', 'SSO nội bộ; dùng 636 cho LDAPS.', 'Mạng & hệ thống'],
  [443, 'TCP/UDP', 'HTTPS (HTTP/3 QUIC dùng UDP)', 'Web mã hóa TLS; UDP 443 cho HTTP/3 (QUIC).', 'Mặc định mọi site; mở cả UDP để bật HTTP/3.', 'Web'],
  [445, 'TCP', 'SMB', 'Chia sẻ file Windows/Samba.', 'Share mạng nội bộ; không mở ra Internet.', 'Mạng & hệ thống'],
  [465, 'TCP', 'SMTPS', 'SMTP qua TLS ngầm định (implicit TLS).', 'Gửi mail từ ứng dụng.', 'Mạng & hệ thống'],
  [514, 'UDP', 'Syslog', 'Gom log hệ thống.', 'Gửi log tới rsyslog/SIEM.', 'DevOps'],
  [587, 'TCP', 'SMTP submission', 'Gửi mail từ client lên server (STARTTLS, có xác thực).', 'Cấu hình SMTP cho app (Gmail, SES...).', 'Mạng & hệ thống'],
  [636, 'TCP', 'LDAPS', 'LDAP qua TLS.', 'Kết nối thư mục an toàn.', 'Mạng & hệ thống'],
  [853, 'TCP', 'DNS over TLS', 'DNS mã hóa (DoT).', 'Private DNS trên Android.', 'Mạng & hệ thống'],
  [993, 'TCP', 'IMAPS', 'IMAP qua TLS.', 'Client mail hiện đại.', 'Mạng & hệ thống'],
  [995, 'TCP', 'POP3S', 'POP3 qua TLS.', 'Client mail hiện đại.', 'Mạng & hệ thống'],
  [1025, 'TCP', 'MailHog / Mailpit SMTP', 'Quy ước: SMTP giả lập để bắt mail khi dev (giao diện web 8025).', 'Test email gửi từ app khi phát triển.', 'Dev server'],
  [1194, 'UDP', 'OpenVPN', 'VPN OpenVPN (mặc định UDP).', 'Dựng VPN.', 'Mạng & hệ thống'],
  [1313, 'TCP', 'Hugo dev server', 'Quy ước: hugo server.', 'Phát triển site Hugo.', 'Dev server'],
  [1433, 'TCP', 'Microsoft SQL Server', 'CSDL SQL Server.', 'Kết nối .NET/SSMS.', 'Cơ sở dữ liệu'],
  [1521, 'TCP', 'Oracle Database', 'Listener Oracle.', 'Kết nối Oracle.', 'Cơ sở dữ liệu'],
  [1883, 'TCP', 'MQTT', 'Giao thức IoT MQTT (không mã hóa).', 'Broker Mosquitto/EMQX.', 'Message & Queue'],
  [2049, 'TCP/UDP', 'NFS', 'Chia sẻ file mạng Unix.', 'Mount volume NFS (Kubernetes, NAS).', 'Mạng & hệ thống'],
  [2181, 'TCP', 'Apache ZooKeeper', 'Điều phối cụm (client port).', 'Kafka cũ, Hadoop, HBase.', 'Message & Queue'],
  [2222, 'TCP', 'SSH thay thế', 'Quy ước: SSH thứ hai (cổng 22 đã dùng, vd. git server/Gitea).', 'Container map 22 sang 2222.', 'Mạng & hệ thống'],
  [2375, 'TCP', 'Docker daemon (không TLS)', 'Docker API không mã hóa; NGUY HIỂM nếu mở ra ngoài.', 'DOCKER_HOST=tcp://...; không nên bật.', 'DevOps'],
  [2376, 'TCP', 'Docker daemon (TLS)', 'Docker API có TLS.', 'Điều khiển Docker từ xa an toàn.', 'DevOps'],
  [2379, 'TCP', 'etcd client', 'API client của etcd (2380 là cổng peer).', 'Kubernetes control plane.', 'DevOps'],
  [3000, 'TCP', 'Dev server (Node/Next.js/Rails/CRA), Grafana', 'Quy ước dev: Next.js, Create React App, Express; Grafana cũng mặc định 3000.', 'npm run dev; cổng đã bận thì đổi sang 3001.', 'Dev server'],
  [3001, 'TCP', 'Dev server thay thế', 'Quy ước: cổng kế tiếp khi 3000 bận.', 'Chạy song song frontend/backend.', 'Dev server'],
  [3306, 'TCP', 'MySQL / MariaDB', 'CSDL MySQL/MariaDB.', 'Kết nối CSDL; không mở ra Internet.', 'Cơ sở dữ liệu'],
  [3389, 'TCP', 'RDP', 'Remote Desktop Windows.', 'Điều khiển máy Windows; mục tiêu tấn công brute-force.', 'Mạng & hệ thống'],
  [3478, 'TCP/UDP', 'STUN / TURN', 'Hỗ trợ WebRTC vượt NAT.', 'Gọi video WebRTC không kết nối được.', 'Mạng & hệ thống'],
  [4000, 'TCP', 'Dev server (Phoenix, Jekyll, Gatsby cũ)', 'Quy ước: Phoenix, Jekyll serve.', 'Phát triển Elixir/Jekyll.', 'Dev server'],
  [4173, 'TCP', 'Vite preview', 'Quy ước: vite preview.', 'Xem thử bản build production.', 'Dev server'],
  [4200, 'TCP', 'Angular CLI', 'Quy ước: ng serve.', 'Phát triển Angular.', 'Dev server'],
  [4222, 'TCP', 'NATS', 'NATS messaging client port.', 'Microservices messaging.', 'Message & Queue'],
  [4321, 'TCP', 'Astro dev server', 'Quy ước: astro dev.', 'Phát triển Astro.', 'Dev server'],
  [5000, 'TCP', 'Flask dev server / Docker Registry', 'Quy ước: Flask mặc định; Docker Registry; macOS AirPlay Receiver chiếm cổng này.', 'flask run bị "Address already in use" trên macOS.', 'Dev server'],
  [5037, 'TCP', 'ADB server', 'Android Debug Bridge server.', 'Debug thiết bị Android.', 'Dev server'],
  [5173, 'TCP', 'Vite dev server', 'Quy ước: vite (mặc định từ Vite 3+).', 'npm run dev với Vite.', 'Dev server'],
  [5353, 'UDP', 'mDNS', 'Multicast DNS (Bonjour/Avahi, .local).', 'Tìm thiết bị trong LAN.', 'Mạng & hệ thống'],
  [5432, 'TCP', 'PostgreSQL', 'CSDL PostgreSQL.', 'psql, ứng dụng kết nối Postgres.', 'Cơ sở dữ liệu'],
  [5555, 'TCP', 'ADB over network', 'Quy ước: adb tcpip 5555.', 'Debug Android qua Wi-Fi.', 'Dev server'],
  [5601, 'TCP', 'Kibana', 'Giao diện Kibana.', 'Xem log trong ELK.', 'DevOps'],
  [5672, 'TCP', 'RabbitMQ (AMQP)', 'Giao thức AMQP 0-9-1 của RabbitMQ.', 'Producer/consumer; giao diện quản trị ở 15672.', 'Message & Queue'],
  [5900, 'TCP', 'VNC', 'Điều khiển màn hình từ xa.', 'Remote desktop Linux/macOS.', 'Mạng & hệ thống'],
  [5984, 'TCP', 'CouchDB', 'CSDL CouchDB HTTP API.', 'Fauxton, PouchDB sync.', 'Cơ sở dữ liệu'],
  [6006, 'TCP', 'Storybook / TensorBoard', 'Quy ước: Storybook dev (6006); TensorBoard cũng dùng.', 'Phát triển UI component.', 'Dev server'],
  [6379, 'TCP', 'Redis', 'Redis key-value/cache.', 'Cache, queue, session; không mở ra Internet.', 'Cơ sở dữ liệu'],
  [6443, 'TCP', 'Kubernetes API server', 'API server của K8s.', 'kubectl kết nối cluster.', 'DevOps'],
  [7474, 'TCP', 'Neo4j (HTTP)', 'Neo4j Browser; giao thức Bolt ở 7687.', 'Truy vấn graph.', 'Cơ sở dữ liệu'],
  [7687, 'TCP', 'Neo4j Bolt', 'Giao thức Bolt của Neo4j.', 'Driver kết nối Neo4j.', 'Cơ sở dữ liệu'],
  [8000, 'TCP', 'Django runserver / python -m http.server', 'Quy ước: Django, http.server, FastAPI/uvicorn.', 'Dev backend Python.', 'Dev server'],
  [8025, 'TCP', 'MailHog / Mailpit web', 'Giao diện web xem mail bắt được (SMTP ở 1025).', 'Xem email test.', 'Dev server'],
  [8080, 'TCP', 'HTTP thay thế', 'Quy ước: web thay thế, proxy, Tomcat, Jenkins, Spring Boot.', 'Chạy không cần quyền root; mặc định nhiều framework Java.', 'Web'],
  [8081, 'TCP', 'Metro bundler (React Native)', 'Quy ước: Metro bundler.', 'Debug React Native.', 'Dev server'],
  [8086, 'TCP', 'InfluxDB', 'CSDL time-series InfluxDB HTTP API.', 'Metric/IoT.', 'Cơ sở dữ liệu'],
  [8200, 'TCP', 'HashiCorp Vault', 'Vault API.', 'Quản lý secret.', 'DevOps'],
  [8443, 'TCP', 'HTTPS thay thế', 'Quy ước: HTTPS thay thế (Tomcat, Kubernetes dashboard...).', 'Chạy TLS không cần root.', 'Web'],
  [8500, 'TCP', 'Consul', 'HTTP API/UI của Consul.', 'Service discovery.', 'DevOps'],
  [8787, 'TCP', 'Wrangler dev', 'Quy ước: wrangler dev (Cloudflare Workers).', 'Phát triển Workers.', 'Dev server'],
  [8883, 'TCP', 'MQTT over TLS', 'MQTT mã hóa.', 'Broker IoT an toàn.', 'Message & Queue'],
  [8888, 'TCP', 'Jupyter Notebook', 'Quy ước: Jupyter.', 'Data science.', 'Dev server'],
  [9000, 'TCP', 'SonarQube / MinIO / PHP-FPM', 'Quy ước: nhiều dịch vụ dùng 9000 (SonarQube, MinIO API, PHP-FPM).', 'Xung đột cổng giữa các dịch vụ dev.', 'DevOps'],
  [9042, 'TCP', 'Cassandra (CQL)', 'Cassandra native transport.', 'Kết nối driver CQL.', 'Cơ sở dữ liệu'],
  [9090, 'TCP', 'Prometheus', 'Giao diện/API Prometheus.', 'Giám sát metric.', 'DevOps'],
  [9092, 'TCP', 'Apache Kafka', 'Broker Kafka.', 'Producer/consumer sự kiện.', 'Message & Queue'],
  [9200, 'TCP', 'Elasticsearch / OpenSearch (HTTP)', 'REST API; cổng 9300 là transport nội bộ cụm.', 'Tìm kiếm full-text, log.', 'Cơ sở dữ liệu'],
  [9229, 'TCP', 'Node.js inspector', 'Quy ước: node --inspect.', 'Debug Node.js bằng Chrome DevTools/VS Code.', 'Dev server'],
  [9300, 'TCP', 'Elasticsearch transport', 'Giao tiếp giữa các node ES.', 'Cluster ES.', 'Cơ sở dữ liệu'],
  [10250, 'TCP', 'Kubelet', 'API của kubelet trên mỗi node.', 'Kubernetes node.', 'DevOps'],
  [11211, 'TCP/UDP', 'Memcached', 'Cache bộ nhớ.', 'Cache; không mở ra Internet.', 'Cơ sở dữ liệu'],
  [11434, 'TCP', 'Ollama', 'Quy ước: Ollama API chạy LLM cục bộ.', 'Gọi mô hình cục bộ.', 'Dev server'],
  [15672, 'TCP', 'RabbitMQ Management', 'Giao diện quản trị RabbitMQ.', 'Xem queue/exchange.', 'Message & Queue'],
  [26257, 'TCP', 'CockroachDB', 'SQL của CockroachDB.', 'Kết nối CockroachDB.', 'Cơ sở dữ liệu'],
  [27017, 'TCP', 'MongoDB', 'CSDL MongoDB.', 'Kết nối mongodb://...; không mở ra Internet.', 'Cơ sở dữ liệu'],
  [50051, 'TCP', 'gRPC', 'Quy ước: cổng ví dụ phổ biến của gRPC (không đăng ký IANA).', 'Dịch vụ gRPC dev.', 'Dev server'],
  [51820, 'UDP', 'WireGuard', 'VPN WireGuard (mặc định).', 'Dựng VPN.', 'Mạng & hệ thống'],
];

export const PORT_CATEGORIES: RefCategory[] = [
  { id: 'Web', label: 'Web' },
  { id: 'Dev server', label: 'Dev server' },
  { id: 'Cơ sở dữ liệu', label: 'Cơ sở dữ liệu' },
  { id: 'Message & Queue', label: 'Message & Queue' },
  { id: 'DevOps', label: 'DevOps' },
  { id: 'Mạng & hệ thống', label: 'Mạng & hệ thống' },
];

export const PORT_ROWS: RefRow[] = PORTS.map(([port, proto, service, desc, when, group]) => ({
  id: `${port}-${proto.toLowerCase().replace('/', '')}`,
  cat: group,
  cells: [String(port), proto, service, desc, when],
}));

export function lookupPort(port: number): RefRow[] {
  return PORT_ROWS.filter((r) => r.cells[0] === String(port));
}

/* ------------------------------------------------------------------ */
/* MIME                                                                */
/* ------------------------------------------------------------------ */

type MI = [ext: string, mime: string, group: string, note: string];

const MIMES: MI[] = [
  ['html', 'text/html', 'Văn bản & mã', 'Trang HTML. Cũng .htm.'],
  ['htm', 'text/html', 'Văn bản & mã', 'Giống .html.'],
  ['css', 'text/css', 'Văn bản & mã', 'Stylesheet.'],
  ['js', 'text/javascript', 'Văn bản & mã', 'JavaScript (RFC 9239); application/javascript là tên cũ vẫn gặp.'],
  ['mjs', 'text/javascript', 'Văn bản & mã', 'ES module.'],
  ['cjs', 'text/javascript', 'Văn bản & mã', 'CommonJS module.'],
  ['json', 'application/json', 'Văn bản & mã', 'JSON, không cần charset (luôn UTF-8).'],
  ['map', 'application/json', 'Văn bản & mã', 'Source map.'],
  ['jsonld', 'application/ld+json', 'Văn bản & mã', 'JSON-LD (dữ liệu có cấu trúc).'],
  ['webmanifest', 'application/manifest+json', 'Văn bản & mã', 'Web App Manifest (PWA).'],
  ['ndjson', 'application/x-ndjson', 'Văn bản & mã', 'JSON mỗi dòng một đối tượng (không đăng ký IANA).'],
  ['xml', 'application/xml', 'Văn bản & mã', 'XML; text/xml cũng hợp lệ.'],
  ['xhtml', 'application/xhtml+xml', 'Văn bản & mã', 'XHTML.'],
  ['rss', 'application/rss+xml', 'Văn bản & mã', 'RSS feed.'],
  ['atom', 'application/atom+xml', 'Văn bản & mã', 'Atom feed.'],
  ['yaml', 'application/yaml', 'Văn bản & mã', 'YAML (RFC 9512); application/x-yaml và text/yaml cũ vẫn gặp.'],
  ['yml', 'application/yaml', 'Văn bản & mã', 'Giống .yaml.'],
  ['txt', 'text/plain', 'Văn bản & mã', 'Văn bản thuần.'],
  ['csv', 'text/csv', 'Văn bản & mã', 'CSV.'],
  ['md', 'text/markdown', 'Văn bản & mã', 'Markdown (RFC 7763).'],
  ['ics', 'text/calendar', 'Văn bản & mã', 'Lịch iCalendar.'],
  ['vcf', 'text/vcard', 'Văn bản & mã', 'Danh thiếp vCard.'],
  ['sql', 'application/sql', 'Văn bản & mã', 'SQL (RFC 6922).'],
  ['sh', 'application/x-sh', 'Văn bản & mã', 'Shell script (không đăng ký IANA).'],
  ['py', 'text/x-python', 'Văn bản & mã', 'Python (không đăng ký IANA).'],
  ['php', 'application/x-httpd-php', 'Văn bản & mã', 'PHP (quy ước máy chủ; thực tế trả về text/html sau khi chạy).'],
  ['wasm', 'application/wasm', 'Văn bản & mã', 'WebAssembly; phải đúng MIME mới dùng được instantiateStreaming.'],
  ['png', 'image/png', 'Ảnh', 'PNG.'],
  ['jpg', 'image/jpeg', 'Ảnh', 'JPEG.'],
  ['jpeg', 'image/jpeg', 'Ảnh', 'JPEG.'],
  ['gif', 'image/gif', 'Ảnh', 'GIF.'],
  ['webp', 'image/webp', 'Ảnh', 'WebP.'],
  ['avif', 'image/avif', 'Ảnh', 'AVIF.'],
  ['jxl', 'image/jxl', 'Ảnh', 'JPEG XL.'],
  ['svg', 'image/svg+xml', 'Ảnh', 'SVG (nhớ "+xml").'],
  ['ico', 'image/vnd.microsoft.icon', 'Ảnh', 'Favicon; image/x-icon cũ vẫn dùng rộng rãi.'],
  ['bmp', 'image/bmp', 'Ảnh', 'Bitmap.'],
  ['tif', 'image/tiff', 'Ảnh', 'TIFF.'],
  ['tiff', 'image/tiff', 'Ảnh', 'TIFF.'],
  ['heic', 'image/heic', 'Ảnh', 'Ảnh iPhone (HEIF).'],
  ['apng', 'image/apng', 'Ảnh', 'PNG động.'],
  ['psd', 'image/vnd.adobe.photoshop', 'Ảnh', 'Photoshop.'],
  ['mp3', 'audio/mpeg', 'Âm thanh', 'MP3.'],
  ['wav', 'audio/wav', 'Âm thanh', 'WAV; audio/x-wav, audio/wave cũng gặp.'],
  ['ogg', 'audio/ogg', 'Âm thanh', 'Ogg audio.'],
  ['oga', 'audio/ogg', 'Âm thanh', 'Ogg audio.'],
  ['opus', 'audio/opus', 'Âm thanh', 'Opus.'],
  ['flac', 'audio/flac', 'Âm thanh', 'FLAC.'],
  ['aac', 'audio/aac', 'Âm thanh', 'AAC.'],
  ['m4a', 'audio/mp4', 'Âm thanh', 'AAC trong MP4.'],
  ['weba', 'audio/webm', 'Âm thanh', 'WebM audio.'],
  ['mid', 'audio/midi', 'Âm thanh', 'MIDI.'],
  ['mp4', 'video/mp4', 'Video', 'MP4.'],
  ['webm', 'video/webm', 'Video', 'WebM.'],
  ['ogv', 'video/ogg', 'Video', 'Ogg video.'],
  ['mov', 'video/quicktime', 'Video', 'QuickTime.'],
  ['avi', 'video/x-msvideo', 'Video', 'AVI.'],
  ['mkv', 'video/x-matroska', 'Video', 'Matroska.'],
  ['mpeg', 'video/mpeg', 'Video', 'MPEG.'],
  ['3gp', 'video/3gpp', 'Video', '3GPP.'],
  ['ts', 'video/mp2t', 'Video', 'MPEG transport stream (HLS). Cẩn thận: .ts cũng là TypeScript, nhiều server trả nhầm MIME này.'],
  ['m3u8', 'application/vnd.apple.mpegurl', 'Video', 'Playlist HLS.'],
  ['woff', 'font/woff', 'Font', 'WOFF.'],
  ['woff2', 'font/woff2', 'Font', 'WOFF2 (nên dùng).'],
  ['ttf', 'font/ttf', 'Font', 'TrueType.'],
  ['otf', 'font/otf', 'Font', 'OpenType.'],
  ['eot', 'application/vnd.ms-fontobject', 'Font', 'Embedded OpenType (cũ).'],
  ['pdf', 'application/pdf', 'Tài liệu', 'PDF.'],
  ['doc', 'application/msword', 'Tài liệu', 'Word cũ.'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Tài liệu', 'Word.'],
  ['xls', 'application/vnd.ms-excel', 'Tài liệu', 'Excel cũ.'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Tài liệu', 'Excel.'],
  ['ppt', 'application/vnd.ms-powerpoint', 'Tài liệu', 'PowerPoint cũ.'],
  ['pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'Tài liệu', 'PowerPoint.'],
  ['odt', 'application/vnd.oasis.opendocument.text', 'Tài liệu', 'OpenDocument văn bản.'],
  ['ods', 'application/vnd.oasis.opendocument.spreadsheet', 'Tài liệu', 'OpenDocument bảng tính.'],
  ['rtf', 'application/rtf', 'Tài liệu', 'Rich Text Format.'],
  ['epub', 'application/epub+zip', 'Tài liệu', 'Sách điện tử EPUB.'],
  ['zip', 'application/zip', 'Nén & nhị phân', 'ZIP.'],
  ['gz', 'application/gzip', 'Nén & nhị phân', 'Gzip.'],
  ['tgz', 'application/gzip', 'Nén & nhị phân', 'tar.gz.'],
  ['tar', 'application/x-tar', 'Nén & nhị phân', 'Tar.'],
  ['bz2', 'application/x-bzip2', 'Nén & nhị phân', 'Bzip2.'],
  ['xz', 'application/x-xz', 'Nén & nhị phân', 'XZ.'],
  ['zst', 'application/zstd', 'Nén & nhị phân', 'Zstandard.'],
  ['7z', 'application/x-7z-compressed', 'Nén & nhị phân', '7-Zip.'],
  ['rar', 'application/vnd.rar', 'Nén & nhị phân', 'RAR.'],
  ['jar', 'application/java-archive', 'Nén & nhị phân', 'Java archive.'],
  ['apk', 'application/vnd.android.package-archive', 'Nén & nhị phân', 'Gói Android.'],
  ['dmg', 'application/x-apple-diskimage', 'Nén & nhị phân', 'Ảnh đĩa macOS.'],
  ['exe', 'application/vnd.microsoft.portable-executable', 'Nén & nhị phân', 'Tệp thực thi Windows; application/x-msdownload là tên cũ.'],
  ['bin', 'application/octet-stream', 'Nén & nhị phân', 'Dữ liệu nhị phân bất kỳ; mặc định khi không biết kiểu.'],
  ['', 'application/x-www-form-urlencoded', 'Dữ liệu gửi đi', 'Form HTML mặc định (key=value&...).'],
  ['', 'multipart/form-data', 'Dữ liệu gửi đi', 'Form có upload file; cần boundary, KHÔNG tự đặt Content-Type khi dùng fetch + FormData.'],
  ['', 'text/event-stream', 'Dữ liệu gửi đi', 'Server-Sent Events.'],
  ['', 'application/problem+json', 'Dữ liệu gửi đi', 'Lỗi API chuẩn RFC 9457.'],
];

export const MIME_CATEGORIES: RefCategory[] = [
  { id: 'Văn bản & mã', label: 'Văn bản & mã' },
  { id: 'Ảnh', label: 'Ảnh' },
  { id: 'Âm thanh', label: 'Âm thanh' },
  { id: 'Video', label: 'Video' },
  { id: 'Font', label: 'Font' },
  { id: 'Tài liệu', label: 'Tài liệu' },
  { id: 'Nén & nhị phân', label: 'Nén & nhị phân' },
  { id: 'Dữ liệu gửi đi', label: 'Dữ liệu gửi đi' },
];

export const MIME_ROWS: RefRow[] = MIMES.map(([ext, mime, group, note]) => ({
  id: ext ? `ext-${ext}` : `mime-${mime}`,
  cat: group,
  cells: [ext ? `.${ext}` : '—', mime, note],
}));

/** Tra theo đuôi file (có/không dấu chấm, không phân biệt hoa thường). */
export function mimeForExt(ext: string): string | undefined {
  const e = ext.trim().toLowerCase().replace(/^\./, '');
  return MIMES.find((m) => m[0] && m[0] === e)?.[1];
}

/** Tra ngược: các đuôi file ứng với một MIME. */
export function extsForMime(mime: string): string[] {
  const m = mime.trim().toLowerCase().split(';')[0].trim();
  return MIMES.filter((x) => x[0] && x[1] === m).map((x) => x[0]);
}

/* ------------------------------------------------------------------ */
/* ASCII                                                               */
/* ------------------------------------------------------------------ */

const CONTROL_NAMES: [string, string, string][] = [
  ['NUL', 'Null', '\\0'], ['SOH', 'Start of Heading', ''], ['STX', 'Start of Text', ''], ['ETX', 'End of Text', ''],
  ['EOT', 'End of Transmission', ''], ['ENQ', 'Enquiry', ''], ['ACK', 'Acknowledge', ''], ['BEL', 'Bell (chuông)', '\\a'],
  ['BS', 'Backspace', '\\b'], ['HT', 'Horizontal Tab', '\\t'], ['LF', 'Line Feed (xuống dòng)', '\\n'], ['VT', 'Vertical Tab', '\\v'],
  ['FF', 'Form Feed', '\\f'], ['CR', 'Carriage Return (về đầu dòng)', '\\r'], ['SO', 'Shift Out', ''], ['SI', 'Shift In', ''],
  ['DLE', 'Data Link Escape', ''], ['DC1', 'Device Control 1 (XON)', ''], ['DC2', 'Device Control 2', ''], ['DC3', 'Device Control 3 (XOFF)', ''],
  ['DC4', 'Device Control 4', ''], ['NAK', 'Negative Acknowledge', ''], ['SYN', 'Synchronous Idle', ''], ['ETB', 'End of Transmission Block', ''],
  ['CAN', 'Cancel', ''], ['EM', 'End of Medium', ''], ['SUB', 'Substitute', ''], ['ESC', 'Escape', '\\e'],
  ['FS', 'File Separator', ''], ['GS', 'Group Separator', ''], ['RS', 'Record Separator', ''], ['US', 'Unit Separator', ''],
];

const ASCII_ENTITY: Record<number, string> = { 34: '&quot;', 38: '&amp;', 39: '&#39;', 60: '&lt;', 62: '&gt;' };

export const ASCII_CATEGORIES: RefCategory[] = [
  { id: 'control', label: 'Ký tự điều khiển (0–31, 127)' },
  { id: 'space', label: 'Khoảng trắng' },
  { id: 'digit', label: 'Chữ số' },
  { id: 'upper', label: 'Chữ hoa' },
  { id: 'lower', label: 'Chữ thường' },
  { id: 'punct', label: 'Dấu & ký hiệu' },
];

export function asciiCategory(n: number): string {
  if (n < 32 || n === 127) return 'control';
  if (n === 32) return 'space';
  if (n >= 48 && n <= 57) return 'digit';
  if (n >= 65 && n <= 90) return 'upper';
  if (n >= 97 && n <= 122) return 'lower';
  return 'punct';
}

export function asciiRow(n: number): RefRow {
  const dec = String(n);
  const hex = n.toString(16).toUpperCase().padStart(2, '0');
  const oct = n.toString(8).padStart(3, '0');
  const bin = n.toString(2).padStart(8, '0');
  let ch: string;
  let name: string;
  if (n < 32) {
    const [abbr, full, esc] = CONTROL_NAMES[n];
    ch = abbr;
    name = `${full}${esc ? ` — escape ${esc}` : ''}`;
  } else if (n === 127) {
    ch = 'DEL';
    name = 'Delete';
  } else if (n === 32) {
    ch = '␠';
    name = 'Space (dấu cách)';
  } else {
    ch = String.fromCharCode(n);
    name = n >= 48 && n <= 57 ? `Chữ số ${ch}` : /[A-Za-z]/.test(ch) ? `Chữ cái ${ch}` : 'Dấu/ký hiệu';
  }
  const entity = ASCII_ENTITY[n] ?? (n >= 32 && n < 127 ? `&#${n};` : '—');
  return { id: dec, cat: asciiCategory(n), cells: [dec, hex, oct, bin, ch, name, entity] };
}

export const ASCII_ROWS: RefRow[] = Array.from({ length: 128 }, (_, i) => asciiRow(i));

/* ------------------------------------------------------------------ */
/* ENTITY / KÝ HIỆU                                                    */
/* ------------------------------------------------------------------ */

type E = [char: string, name: string, entity: string, group: string];

const SYMBOLS: E[] = [
  ['<', 'Nhỏ hơn', '&lt;', 'HTML cơ bản'], ['>', 'Lớn hơn', '&gt;', 'HTML cơ bản'], ['&', 'Dấu và', '&amp;', 'HTML cơ bản'],
  ['"', 'Nháy kép', '&quot;', 'HTML cơ bản'], ["'", 'Nháy đơn', '&apos;', 'HTML cơ bản'], [' ', 'Khoảng trắng không ngắt dòng', '&nbsp;', 'HTML cơ bản'],
  [' ', 'Khoảng trắng en', '&ensp;', 'HTML cơ bản'], [' ', 'Khoảng trắng em', '&emsp;', 'HTML cơ bản'], [' ', 'Khoảng trắng mỏng', '&thinsp;', 'HTML cơ bản'],
  ['©', 'Bản quyền', '&copy;', 'Ký hiệu'], ['®', 'Đã đăng ký', '&reg;', 'Ký hiệu'], ['™', 'Nhãn hiệu', '&trade;', 'Ký hiệu'],
  ['§', 'Mục (section)', '&sect;', 'Ký hiệu'], ['¶', 'Đoạn (pilcrow)', '&para;', 'Ký hiệu'], ['†', 'Dao găm', '&dagger;', 'Ký hiệu'],
  ['•', 'Chấm tròn đặc', '&bull;', 'Ký hiệu'], ['·', 'Chấm giữa', '&middot;', 'Ký hiệu'], ['°', 'Độ', '&deg;', 'Ký hiệu'],
  ['♠', 'Bích', '&spades;', 'Ký hiệu'], ['♣', 'Chuồn', '&clubs;', 'Ký hiệu'], ['♥', 'Cơ', '&hearts;', 'Ký hiệu'], ['♦', 'Rô', '&diams;', 'Ký hiệu'],
  ['✓', 'Dấu tick', '&check;', 'Ký hiệu'], ['✗', 'Dấu x', '&cross;', 'Ký hiệu'], ['★', 'Sao đặc', '&starf;', 'Ký hiệu'], ['☆', 'Sao rỗng', '&star;', 'Ký hiệu'],
  ['☎', 'Điện thoại', '&phone;', 'Ký hiệu'], ['⌘', 'Phím Command', '', 'Ký hiệu'], ['⌥', 'Phím Option', '', 'Ký hiệu'], ['⇧', 'Phím Shift', '', 'Ký hiệu'],
  ['⏎', 'Phím Return', '', 'Ký hiệu'], ['⌫', 'Xóa lùi', '', 'Ký hiệu'], ['⚠', 'Cảnh báo', '', 'Ký hiệu'], ['✔', 'Tick đậm', '', 'Ký hiệu'],
  ['✘', 'Dấu x đậm', '', 'Ký hiệu'], ['☀', 'Mặt trời', '', 'Ký hiệu'], ['☂', 'Ô', '', 'Ký hiệu'], ['✉', 'Phong bì', '', 'Ký hiệu'],
  ['…', 'Dấu ba chấm', '&hellip;', 'Dấu câu'], ['—', 'Gạch ngang dài (em dash)', '&mdash;', 'Dấu câu'], ['–', 'Gạch ngang ngắn (en dash)', '&ndash;', 'Dấu câu'],
  ['‘', 'Nháy đơn mở', '&lsquo;', 'Dấu câu'], ['’', 'Nháy đơn đóng', '&rsquo;', 'Dấu câu'], ['“', 'Nháy kép mở', '&ldquo;', 'Dấu câu'], ['”', 'Nháy kép đóng', '&rdquo;', 'Dấu câu'],
  ['«', 'Dấu ngoặc kép góc trái', '&laquo;', 'Dấu câu'], ['»', 'Dấu ngoặc kép góc phải', '&raquo;', 'Dấu câu'], ['¿', 'Chấm hỏi ngược', '&iquest;', 'Dấu câu'], ['¡', 'Chấm than ngược', '&iexcl;', 'Dấu câu'],
  ['←', 'Mũi tên trái', '&larr;', 'Mũi tên'], ['→', 'Mũi tên phải', '&rarr;', 'Mũi tên'], ['↑', 'Mũi tên lên', '&uarr;', 'Mũi tên'], ['↓', 'Mũi tên xuống', '&darr;', 'Mũi tên'],
  ['↔', 'Mũi tên hai chiều ngang', '&harr;', 'Mũi tên'], ['↕', 'Mũi tên hai chiều dọc', '', 'Mũi tên'], ['⇐', 'Mũi tên đôi trái', '&lArr;', 'Mũi tên'], ['⇒', 'Mũi tên đôi phải (suy ra)', '&rArr;', 'Mũi tên'],
  ['⇔', 'Mũi tên đôi hai chiều (tương đương)', '&hArr;', 'Mũi tên'], ['↵', 'Xuống dòng (Enter)', '&crarr;', 'Mũi tên'], ['↗', 'Mũi tên chéo lên phải', '', 'Mũi tên'], ['↘', 'Mũi tên chéo xuống phải', '', 'Mũi tên'],
  ['⟶', 'Mũi tên dài phải', '', 'Mũi tên'], ['➜', 'Mũi tên đậm phải', '', 'Mũi tên'],
  ['±', 'Cộng trừ', '&plusmn;', 'Toán'], ['×', 'Nhân', '&times;', 'Toán'], ['÷', 'Chia', '&divide;', 'Toán'], ['−', 'Dấu trừ toán học', '&minus;', 'Toán'],
  ['≠', 'Khác', '&ne;', 'Toán'], ['≤', 'Nhỏ hơn hoặc bằng', '&le;', 'Toán'], ['≥', 'Lớn hơn hoặc bằng', '&ge;', 'Toán'], ['≈', 'Xấp xỉ', '&asymp;', 'Toán'],
  ['≡', 'Đồng nhất', '&equiv;', 'Toán'], ['∞', 'Vô cực', '&infin;', 'Toán'], ['√', 'Căn bậc hai', '&radic;', 'Toán'], ['∑', 'Tổng', '&sum;', 'Toán'],
  ['∏', 'Tích', '&prod;', 'Toán'], ['∂', 'Đạo hàm riêng', '&part;', 'Toán'], ['∫', 'Tích phân', '&int;', 'Toán'], ['∀', 'Với mọi', '&forall;', 'Toán'],
  ['∃', 'Tồn tại', '&exist;', 'Toán'], ['∅', 'Tập rỗng', '&empty;', 'Toán'], ['∈', 'Thuộc', '&isin;', 'Toán'], ['∉', 'Không thuộc', '&notin;', 'Toán'],
  ['∩', 'Giao', '&cap;', 'Toán'], ['∪', 'Hợp', '&cup;', 'Toán'], ['⊂', 'Tập con', '&sub;', 'Toán'], ['⊃', 'Tập cha', '&sup;', 'Toán'],
  ['∧', 'Và (logic)', '&and;', 'Toán'], ['∨', 'Hoặc (logic)', '&or;', 'Toán'], ['¬', 'Phủ định', '&not;', 'Toán'], ['µ', 'Micro', '&micro;', 'Toán'],
  ['½', 'Một phần hai', '&frac12;', 'Toán'], ['¼', 'Một phần tư', '&frac14;', 'Toán'], ['¾', 'Ba phần tư', '&frac34;', 'Toán'], ['²', 'Bình phương', '&sup2;', 'Toán'],
  ['³', 'Lập phương', '&sup3;', 'Toán'], ['π', 'Pi', '&pi;', 'Toán'], ['α', 'Alpha', '&alpha;', 'Toán'], ['β', 'Beta', '&beta;', 'Toán'],
  ['γ', 'Gamma', '&gamma;', 'Toán'], ['δ', 'Delta nhỏ', '&delta;', 'Toán'], ['Δ', 'Delta hoa', '&Delta;', 'Toán'], ['λ', 'Lambda', '&lambda;', 'Toán'],
  ['μ', 'Mu', '&mu;', 'Toán'], ['σ', 'Sigma nhỏ', '&sigma;', 'Toán'], ['Σ', 'Sigma hoa', '&Sigma;', 'Toán'], ['θ', 'Theta', '&theta;', 'Toán'], ['Ω', 'Omega hoa', '&Omega;', 'Toán'],
  ['€', 'Euro', '&euro;', 'Tiền tệ'], ['£', 'Bảng Anh', '&pound;', 'Tiền tệ'], ['¥', 'Yên / Nhân dân tệ', '&yen;', 'Tiền tệ'], ['¢', 'Xu (cent)', '&cent;', 'Tiền tệ'],
  ['¤', 'Ký hiệu tiền tệ chung', '&curren;', 'Tiền tệ'], ['₫', 'Đồng Việt Nam', '', 'Tiền tệ'], ['₹', 'Rupee Ấn Độ', '', 'Tiền tệ'], ['₩', 'Won Hàn Quốc', '', 'Tiền tệ'],
  ['₿', 'Bitcoin', '', 'Tiền tệ'], ['$', 'Đô la', '&dollar;', 'Tiền tệ'],
  ['─', 'Đường ngang', '', 'Box-drawing'], ['│', 'Đường dọc', '', 'Box-drawing'], ['┌', 'Góc trên trái', '', 'Box-drawing'], ['┐', 'Góc trên phải', '', 'Box-drawing'],
  ['└', 'Góc dưới trái', '', 'Box-drawing'], ['┘', 'Góc dưới phải', '', 'Box-drawing'], ['├', 'Nhánh phải', '', 'Box-drawing'], ['┤', 'Nhánh trái', '', 'Box-drawing'],
  ['┬', 'Nhánh xuống', '', 'Box-drawing'], ['┴', 'Nhánh lên', '', 'Box-drawing'], ['┼', 'Giao nhau', '', 'Box-drawing'], ['═', 'Đường ngang đôi', '', 'Box-drawing'],
  ['║', 'Đường dọc đôi', '', 'Box-drawing'], ['╔', 'Góc trên trái đôi', '', 'Box-drawing'], ['╗', 'Góc trên phải đôi', '', 'Box-drawing'], ['╚', 'Góc dưới trái đôi', '', 'Box-drawing'],
  ['╝', 'Góc dưới phải đôi', '', 'Box-drawing'], ['╠', 'Nhánh phải đôi', '', 'Box-drawing'], ['╣', 'Nhánh trái đôi', '', 'Box-drawing'], ['╦', 'Nhánh xuống đôi', '', 'Box-drawing'],
  ['╩', 'Nhánh lên đôi', '', 'Box-drawing'], ['╬', 'Giao nhau đôi', '', 'Box-drawing'], ['▀', 'Nửa khối trên', '', 'Box-drawing'], ['▄', 'Nửa khối dưới', '', 'Box-drawing'],
  ['█', 'Khối đặc', '', 'Box-drawing'], ['░', 'Khối mờ nhẹ', '', 'Box-drawing'], ['▒', 'Khối mờ vừa', '', 'Box-drawing'], ['▓', 'Khối mờ đậm', '', 'Box-drawing'],
];

export const SYMBOL_CATEGORIES: RefCategory[] = [
  { id: 'HTML cơ bản', label: 'HTML cơ bản' },
  { id: 'Dấu câu', label: 'Dấu câu' },
  { id: 'Mũi tên', label: 'Mũi tên' },
  { id: 'Toán', label: 'Toán & chữ Hy Lạp' },
  { id: 'Tiền tệ', label: 'Tiền tệ' },
  { id: 'Ký hiệu', label: 'Ký hiệu khác' },
  { id: 'Box-drawing', label: 'Box-drawing' },
];

export const codePointLabel = (ch: string) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;

export const SYMBOL_ROWS: RefRow[] = SYMBOLS.map(([ch, name, entity, group]) => {
  const cp = ch.codePointAt(0) ?? 0;
  const shown = ch === ' ' ? '␣' : ch === ' ' || ch === ' ' || ch === ' ' ? '␣' : ch;
  return {
    id: `u${cp.toString(16)}`,
    cat: group,
    cells: [shown, name, entity || '—', `&#${cp};`, codePointLabel(ch)],
  };
});

/* ------------------------------------------------------------------ */
/* BẢNG TỔNG HỢP                                                       */
/* ------------------------------------------------------------------ */

export const REF_TABLES: RefTable[] = [
  {
    id: 'status', label: 'HTTP status', hint: 'Mã trạng thái HTTP 1xx–5xx, kèm mã không chuẩn của nginx/Cloudflare.',
    columns: ['Mã', 'Tên', 'Ý nghĩa', 'Khi nào gặp', 'Cách xử lý'], mono: [0], categories: STATUS_CATEGORIES, rows: STATUS_ROWS,
  },
  {
    id: 'headers', label: 'HTTP header', hint: 'Header request/response phổ biến, bảo mật, CORS, cache và các directive của Cache-Control.',
    columns: ['Header', 'Loại', 'Mô tả', 'Ví dụ', 'Khi nào gặp'], mono: [0, 3], categories: HEADER_CATEGORIES, rows: HEADER_ROWS,
  },
  {
    id: 'methods', label: 'HTTP method', hint: 'Ngữ nghĩa các method theo RFC 9110: an toàn, idempotent, cacheable, body.',
    columns: ['Method', 'Ý nghĩa', 'An toàn (safe)', 'Idempotent', 'Cacheable', 'Body request', 'Body response', 'Khi nào dùng'], mono: [0], categories: [], rows: METHOD_ROWS,
  },
  {
    id: 'ports', label: 'Cổng mạng', hint: 'Cổng TCP/UDP thông dụng và cổng mặc định của dev server, CSDL, message queue.',
    columns: ['Cổng', 'Giao thức', 'Dịch vụ', 'Mô tả', 'Khi nào gặp'], mono: [0], categories: PORT_CATEGORIES, rows: PORT_ROWS,
  },
  {
    id: 'mime', label: 'MIME', hint: 'Tra cả hai chiều: đuôi file → MIME type và MIME type → đuôi file.',
    columns: ['Đuôi file', 'MIME type', 'Ghi chú'], mono: [0, 1], categories: MIME_CATEGORIES, rows: MIME_ROWS,
  },
  {
    id: 'ascii', label: 'Bảng ASCII', hint: 'Mã 0–127: thập phân, hex, bát phân, nhị phân và tên ký tự điều khiển.',
    columns: ['Dec', 'Hex', 'Oct', 'Bin', 'Ký tự', 'Tên / ghi chú', 'HTML entity'], mono: [0, 1, 2, 3, 4, 6], categories: ASCII_CATEGORIES, rows: ASCII_ROWS,
  },
  {
    id: 'symbols', label: 'Entity & ký hiệu', hint: 'Bấm vào ô để sao chép ký tự, entity hoặc mã Unicode.',
    columns: ['Ký tự', 'Tên', 'Entity', 'Mã số', 'Unicode'], mono: [0, 2, 3, 4], categories: SYMBOL_CATEGORIES, rows: SYMBOL_ROWS,
  },
];

/* ------------------------------------------------------------------ */
/* CORS PREFLIGHT                                                      */
/* ------------------------------------------------------------------ */

export interface CorsInput {
  sameOrigin: boolean;
  method: string;
  /** Tên header tùy chỉnh do JS đặt (cách nhau dấu phẩy), không gồm Content-Type. */
  headers: string;
  contentType: string;
  credentials: boolean;
  /** Origin của trang gọi (để minh họa). */
  origin: string;
  /** Header phản hồi tùy chỉnh mà JS cần đọc. */
  exposeHeaders: string;
}

export interface CorsResult {
  error?: string;
  /** Có cần gửi preflight (OPTIONS) hay không. */
  preflight: boolean;
  /** Có áp dụng cơ chế CORS không (cross-origin). */
  cors: boolean;
  reasons: string[];
  /** Header của request preflight. */
  preflightRequest: [string, string][];
  /** Header server PHẢI trả lời cho OPTIONS (nếu có preflight). */
  preflightResponse: [string, string][];
  /** Header server PHẢI trả trong phản hồi thật. */
  actualResponse: [string, string][];
  notes: string[];
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'POST']);
const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK']);
/** Method được trình duyệt chuẩn hóa sang chữ HOA; PATCH thì không. */
const NORMALIZED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']);
const SAFE_HEADERS = new Set(['accept', 'accept-language', 'content-language', 'content-type', 'range']);
const SAFE_CONTENT_TYPES = new Set(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']);
/** Header trình duyệt tự quản lý; JS không đặt được. */
const FORBIDDEN_HEADERS = new Set([
  'accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method', 'connection', 'content-length',
  'cookie', 'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'set-cookie', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'via',
]);
/** Header phản hồi được JS đọc mặc định (CORS-safelisted response headers). */
const SAFE_RESPONSE_HEADERS = new Set(['cache-control', 'content-language', 'content-length', 'content-type', 'expires', 'last-modified', 'pragma']);

const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function parseHeaderList(s: string): string[] {
  const out: string[] = [];
  for (const raw of s.split(',')) {
    const t = raw.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

export function checkCors(input: CorsInput): CorsResult {
  const empty: CorsResult = { preflight: false, cors: false, reasons: [], preflightRequest: [], preflightResponse: [], actualResponse: [], notes: [] };
  const rawMethod = input.method.trim();
  if (!rawMethod || !HEADER_TOKEN.test(rawMethod)) return { ...empty, error: 'Method không hợp lệ.' };
  const upper = rawMethod.toUpperCase();
  if (FORBIDDEN_METHODS.has(upper)) return { ...empty, error: `Method ${upper} bị cấm: fetch/XHR không được dùng.` };
  const normalized = NORMALIZED_METHODS.has(upper);
  const method = normalized ? upper : rawMethod;

  const names = parseHeaderList(input.headers);
  for (const n of names) if (!HEADER_TOKEN.test(n)) return { ...empty, error: `Tên header không hợp lệ: "${n}".` };
  const forbiddenGiven = names.filter((n) => FORBIDDEN_HEADERS.has(n.toLowerCase()) || /^(sec-|proxy-)/i.test(n));
  const effective = names.filter((n) => !forbiddenGiven.includes(n));
  const notes: string[] = [];
  if (forbiddenGiven.length) notes.push(`Header ${forbiddenGiven.join(', ')} do trình duyệt tự quản lý; JS không đặt được nên bỏ qua.`);
  if (rawMethod !== upper) {
    notes.push(
      normalized
        ? `Trình duyệt tự chuẩn hóa "${rawMethod}" thành "${upper}".`
        : `Method "${rawMethod}" không được chuẩn hóa chữ hoa nên server nhận đúng "${rawMethod}" (sai). Hãy viết "${upper}".`
    );
  }

  if (input.sameOrigin) {
    return { ...empty, notes: [...notes, 'Cùng origin: không áp dụng CORS, không có preflight.'], reasons: ['Request cùng origin.'] };
  }

  const reasons: string[] = [];
  if (!SAFE_METHODS.has(method)) reasons.push(`Method ${method} không thuộc GET/HEAD/POST.`);

  const nonSafe: string[] = [];
  for (const n of effective) if (!SAFE_HEADERS.has(n.toLowerCase())) nonSafe.push(n);
  const ct = input.contentType.trim();
  const ctEssence = ct.split(';')[0].trim().toLowerCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const ctGiven = ct !== '' && hasBody;
  if (ctGiven && !SAFE_CONTENT_TYPES.has(ctEssence)) {
    reasons.push(`Content-Type "${ctEssence}" không phải một trong application/x-www-form-urlencoded, multipart/form-data, text/plain.`);
    nonSafe.push('Content-Type');
  }
  if (ct !== '' && !hasBody) notes.push('GET/HEAD không có body nên Content-Type không đóng vai trò gì.');
  for (const n of nonSafe.filter((x) => x.toLowerCase() !== 'content-type' || !ctGiven)) {
    reasons.push(`Header "${n}" không nằm trong danh sách an toàn (Accept, Accept-Language, Content-Language, Content-Type, Range).`);
  }
  // loại trùng
  const uniqReasons = [...new Set(reasons)];
  const preflight = uniqReasons.length > 0;

  const origin = input.origin.trim() || 'https://app.example.com';
  const requestHeaders = [...new Set(nonSafe.map((n) => n.toLowerCase()))].sort();

  const preflightRequest: [string, string][] = [];
  const preflightResponse: [string, string][] = [];
  if (preflight) {
    preflightRequest.push(['OPTIONS', '(đường dẫn của request)'], ['Origin', origin], ['Access-Control-Request-Method', method]);
    if (requestHeaders.length) preflightRequest.push(['Access-Control-Request-Headers', requestHeaders.join(', ')]);
    preflightResponse.push(['(Trạng thái)', '2xx (thường 204 hoặc 200)']);
    preflightResponse.push(['Access-Control-Allow-Origin', input.credentials ? origin : `${origin} (hoặc *)`]);
    if (!SAFE_METHODS.has(method)) preflightResponse.push(['Access-Control-Allow-Methods', method]);
    if (requestHeaders.length) {
      preflightResponse.push(['Access-Control-Allow-Headers', requestHeaders.join(', ')]);
      if (requestHeaders.includes('authorization')) notes.push('Authorization phải được liệt kê tường minh trong Access-Control-Allow-Headers; ký tự * không bao gồm nó.');
    }
    if (input.credentials) preflightResponse.push(['Access-Control-Allow-Credentials', 'true']);
    preflightResponse.push(['Access-Control-Max-Age', '600 (tùy chọn, giảm số lần preflight)']);
    preflightResponse.push(['Vary', 'Origin (nếu trả origin động)']);
  }

  const actual: [string, string][] = [['Access-Control-Allow-Origin', input.credentials ? origin : `${origin} (hoặc *)`]];
  if (input.credentials) {
    actual.push(['Access-Control-Allow-Credentials', 'true']);
    notes.push('Có credentials: Access-Control-Allow-Origin KHÔNG được là *, phải là origin cụ thể; Allow-Headers/Allow-Methods cũng không dùng * (ký tự * bị hiểu là chữ).');
    notes.push('Phía client phải bật credentials: "include" (fetch) hoặc withCredentials = true (XHR); cookie bên thứ ba còn phụ thuộc SameSite=None; Secure.');
  }
  actual.push(['Vary', 'Origin (nếu trả origin động)']);
  const expose = parseHeaderList(input.exposeHeaders).filter((h) => !SAFE_RESPONSE_HEADERS.has(h.toLowerCase()));
  if (expose.length) {
    actual.push(['Access-Control-Expose-Headers', expose.join(', ')]);
    notes.push('JS chỉ đọc được các header phản hồi an toàn mặc định (Cache-Control, Content-Language, Content-Length, Content-Type, Expires, Last-Modified, Pragma) trừ khi được liệt kê trong Access-Control-Expose-Headers.');
  }
  if (preflight) notes.push('Lỗi thường gặp: server chỉ xử lý GET/POST nên OPTIONS trả 404/405, hoặc bị middleware xác thực chặn 401 trước khi tới CORS. OPTIONS không mang theo cookie/Authorization.');
  else notes.push('Request "đơn giản": trình duyệt gửi thẳng, rồi mới kiểm tra header CORS trong phản hồi. Nếu thiếu, JS không đọc được kết quả (server vẫn đã xử lý request).');
  notes.push('Redirect trong preflight không được phép; preflight phải trả trực tiếp 2xx.');

  return {
    preflight,
    cors: true,
    reasons: preflight ? uniqReasons : ['Method và header thuộc nhóm "an toàn" nên không cần preflight.'],
    preflightRequest,
    preflightResponse,
    actualResponse: actual,
    notes,
  };
}

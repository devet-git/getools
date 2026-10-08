/**
 * Nginx Config Generator + Analyzer (logic thuần, chạy trên trình duyệt).
 *  - Phần 1: từ điển directive (ngữ cảnh, cú pháp, mô tả tiếng Việt)
 *  - Phần 2: tokenizer + parser (báo lỗi cú pháp kèm dòng/cột)
 *  - Phần 3: lint + chế độ "Giải thích" + thử khớp location
 *  - Phần 4: bộ sinh cấu hình (preset kịch bản)
 * Không throw ra ngoài với dữ liệu xấu; mọi thông báo bằng tiếng Việt.
 */

/* ========================================================================== */
/* 1. TỪ ĐIỂN DIRECTIVE                                                        */
/* ========================================================================== */

export interface DirectiveInfo {
  name: string;
  /** Các ngữ cảnh cho phép: main, events, http, server, location, upstream; '*' = bất kỳ */
  contexts: string[];
  syntax: string;
  desc: string;
}

const CTX_LETTER: Record<string, string> = {
  m: 'main',
  e: 'events',
  h: 'http',
  s: 'server',
  l: 'location',
  u: 'upstream',
};

/** name|ngữ cảnh (m=main e=events h=http s=server l=location u=upstream *=mọi nơi)|cú pháp|mô tả */
const DICT_RAW: string[] = [
  // --- main ---
  'user|m|user user [group];|Tài khoản hệ điều hành chạy worker process.',
  'worker_processes|m|worker_processes số|auto;|Số worker process; thường đặt auto (= số core CPU).',
  'worker_rlimit_nofile|m|worker_rlimit_nofile số;|Giới hạn số file descriptor mở của mỗi worker.',
  'worker_cpu_affinity|m|worker_cpu_affinity mask...|auto;|Gắn worker vào các nhân CPU cụ thể.',
  'worker_priority|m|worker_priority số;|Độ ưu tiên (nice) của worker.',
  'worker_shutdown_timeout|m|worker_shutdown_timeout thời_gian;|Thời gian chờ tắt worker nhẹ nhàng khi reload.',
  'pid|m|pid file;|Đường dẫn file lưu PID của master process.',
  'daemon|m|daemon on|off;|Chạy nền hay foreground (Docker thường dùng "daemon off").',
  'master_process|m|master_process on|off;|Bật/tắt mô hình master-worker (chỉ dùng để debug).',
  'env|m|env biến[=giá_trị];|Giữ/đặt biến môi trường cho worker.',
  'load_module|m|load_module file;|Nạp module động (.so), phải đặt đầu file.',
  'pcre_jit|m|pcre_jit on|off;|Bật biên dịch JIT cho regex (nhanh hơn).',
  'thread_pool|m|thread_pool tên threads=N [max_queue=M];|Khai báo thread pool cho aio threads.',
  'timer_resolution|m|timer_resolution khoảng;|Giảm số lần gọi gettimeofday().',
  'working_directory|m|working_directory đường_dẫn;|Thư mục làm việc (nơi ghi core dump).',
  'lock_file|m|lock_file file;|File khóa cho accept_mutex.',
  'ssl_engine|m|ssl_engine tên;|Engine phần cứng cho OpenSSL.',
  'events|m|events { ... }|Khối cấu hình xử lý kết nối.',
  'http|m|http { ... }|Khối chứa mọi cấu hình HTTP (server, upstream, map...).',
  'stream|m|stream { ... }|Khối proxy TCP/UDP (tầng 4).',
  'mail|m|mail { ... }|Khối proxy mail (IMAP/POP3/SMTP).',
  // --- events ---
  'worker_connections|e|worker_connections số;|Số kết nối đồng thời tối đa mỗi worker.',
  'use|e|use method;|Cơ chế xử lý kết nối (epoll, kqueue...), thường để tự động.',
  'multi_accept|e|multi_accept on|off;|Worker nhận nhiều kết nối mới cùng lúc.',
  'accept_mutex|e|accept_mutex on|off;|Luân phiên nhận kết nối giữa các worker.',
  'accept_mutex_delay|e|accept_mutex_delay thời_gian;|Thời gian chờ để worker khác nhận kết nối.',
  'worker_aio_requests|e|worker_aio_requests số;|Số thao tác AIO chờ tối đa mỗi worker.',
  'debug_connection|e|debug_connection địa_chỉ|CIDR;|Bật log debug cho một số client nhất định.',
  // --- khối / định tuyến cốt lõi ---
  'server|hu|server { ... } (trong http) | server địa_chỉ [tham_số]; (trong upstream)|Trong http: khai báo virtual host. Trong upstream: khai báo một máy chủ backend.',
  'location|sl|location [= | ~ | ~* | ^~] uri { ... }|Khối cấu hình theo URI của request (xem thứ tự ưu tiên khớp).',
  'upstream|h|upstream tên { ... }|Nhóm máy chủ backend để proxy_pass/fastcgi_pass tới (cân bằng tải).',
  'map|h|map $nguồn $biến { ... }|Tạo biến mới từ giá trị của biến khác (bảng tra).',
  'geo|h|geo [$nguồn] $biến { ... }|Tạo biến theo địa chỉ IP client (CIDR).',
  'split_clients|h|split_clients chuỗi $biến { ... }|Chia client theo tỉ lệ % (A/B testing).',
  'types|hsl|types { mime ext...; }|Bảng ánh xạ đuôi file sang MIME type.',
  'limit_except|l|limit_except METHOD... { ... }|Giới hạn cấu hình (allow/deny...) cho các method NGOÀI danh sách.',
  'if|sl|if (điều_kiện) { ... }|Điều kiện trong rewrite module. Cẩn thận: "if is evil" trong location.',
  'charset_map|h|charset_map a b { ... }|Bảng chuyển mã ký tự.',
  'match|h|match tên { ... }|Điều kiện health check (nginx Plus).',
  'include|*|include file|mask;|Chèn nội dung file khác (hỗ trợ glob như conf.d/*.conf).',
  'listen|s|listen địa_chỉ[:cổng] [ssl] [quic] [default_server] [reuseport] ...;|Địa chỉ/cổng server lắng nghe và các tuỳ chọn socket.',
  'server_name|s|server_name tên...;|Tên miền mà server block này phục vụ (hỗ trợ *.x, .x, ~regex, _).',
  'root|hsl|root đường_dẫn;|Thư mục gốc chứa file; URI được nối vào sau root.',
  'alias|l|alias đường_dẫn;|Thay phần location khớp bằng đường_dẫn (khác root, cần khớp dấu "/").',
  'index|hsl|index file...;|Danh sách file index khi URI kết thúc bằng "/".',
  'try_files|sl|try_files file... uri|=code;|Thử lần lượt các file, tham số cuối là fallback (URI, =code hoặc @named).',
  'error_page|hsl|error_page code... [=[response]] uri;|Chỉ định trang/URI trả về cho mã lỗi.',
  'return|sl|return code [text|URL];|Trả về ngay mã trạng thái (và nội dung/URL redirect).',
  'rewrite|hsl|rewrite regex thay_thế [flag];|Viết lại URI bằng regex; flag: last, break, redirect, permanent.',
  'set|hsl|set $biến giá_trị;|Gán giá trị cho biến.',
  'break|hsl|break;|Dừng xử lý các chỉ thị rewrite tiếp theo.',
  'internal|l|internal;|Location chỉ dùng nội bộ (error_page, rewrite, X-Accel-Redirect).',
  'rewrite_log|hsl|rewrite_log on|off;|Ghi log rewrite vào error_log (mức notice).',
  'uninitialized_variable_warn|hsl|uninitialized_variable_warn on|off;|Cảnh báo khi dùng biến chưa khởi tạo.',
  'satisfy|hsl|satisfy all|any;|all: phải thoả mọi cơ chế truy cập; any: thoả một trong số đó.',
  'allow|hsl|allow địa_chỉ|CIDR|all;|Cho phép IP/mạng truy cập.',
  'deny|hsl|deny địa_chỉ|CIDR|all;|Chặn IP/mạng truy cập.',
  'auth_basic|hsl|auth_basic "realm"|off;|Bật HTTP Basic Auth với tên vùng (realm).',
  'auth_basic_user_file|hsl|auth_basic_user_file file;|File htpasswd chứa user:mật_khẩu_băm.',
  'auth_request|hsl|auth_request uri|off;|Uỷ quyền bằng subrequest tới dịch vụ xác thực.',
  'auth_request_set|hsl|auth_request_set $biến giá_trị;|Gán biến từ kết quả subrequest auth_request.',
  'auth_delay|hsl|auth_delay thời_gian;|Trì hoãn phản hồi 401 để chống dò mật khẩu.',
  'autoindex|hsl|autoindex on|off;|Hiển thị danh sách thư mục (nguy cơ lộ file).',
  'autoindex_exact_size|hsl|autoindex_exact_size on|off;|Hiện kích thước chính xác (byte) hay làm tròn.',
  'autoindex_format|hsl|autoindex_format html|xml|json|jsonp;|Định dạng trang danh sách thư mục.',
  'autoindex_localtime|hsl|autoindex_localtime on|off;|Hiện giờ địa phương thay vì GMT.',
  // --- cấu hình HTTP chung ---
  'default_type|hsl|default_type mime;|MIME mặc định khi không xác định được từ đuôi file.',
  'sendfile|hsl|sendfile on|off;|Gửi file bằng sendfile() của kernel (nhanh, tiết kiệm CPU).',
  'sendfile_max_chunk|hsl|sendfile_max_chunk kích_thước;|Giới hạn dữ liệu mỗi lần sendfile (tránh 1 kết nối chiếm worker).',
  'tcp_nopush|hsl|tcp_nopush on|off;|Gộp header + dữ liệu trong 1 gói (dùng cùng sendfile).',
  'tcp_nodelay|hsl|tcp_nodelay on|off;|Tắt thuật toán Nagle cho kết nối keep-alive.',
  'keepalive_timeout|hslu|keepalive_timeout thời_gian [header_timeout];|Thời gian giữ kết nối keep-alive nhàn rỗi.',
  'keepalive_requests|hslu|keepalive_requests số;|Số request tối đa trên một kết nối keep-alive.',
  'keepalive_time|hslu|keepalive_time thời_gian;|Tổng thời gian tối đa một kết nối keep-alive được sống.',
  'keepalive_disable|hsl|keepalive_disable none|browser...;|Tắt keep-alive cho một số trình duyệt cũ.',
  'send_timeout|hsl|send_timeout thời_gian;|Timeout giữa hai lần ghi dữ liệu cho client.',
  'lingering_close|hsl|lingering_close off|on|always;|Cách đóng kết nối khi client còn gửi dữ liệu.',
  'lingering_time|hsl|lingering_time thời_gian;|Thời gian tối đa tiếp tục đọc body sau khi từ chối request.',
  'lingering_timeout|hsl|lingering_timeout thời_gian;|Timeout chờ dữ liệu thêm khi lingering_close.',
  'reset_timedout_connection|hsl|reset_timedout_connection on|off;|Reset kết nối bị timeout để giải phóng bộ nhớ nhanh.',
  'send_lowat|hsl|send_lowat kích_thước;|Ngưỡng low-water cho send buffer (FreeBSD).',
  'client_max_body_size|hsl|client_max_body_size kích_thước;|Kích thước body request tối đa (mặc định 1m; vượt → 413). 0 = không giới hạn.',
  'client_body_buffer_size|hsl|client_body_buffer_size kích_thước;|Bộ đệm RAM cho body request.',
  'client_body_timeout|hsl|client_body_timeout thời_gian;|Timeout đọc body request.',
  'client_body_temp_path|hsl|client_body_temp_path đường_dẫn;|Thư mục file tạm khi body lớn hơn buffer.',
  'client_body_in_file_only|hsl|client_body_in_file_only on|clean|off;|Luôn ghi body ra file.',
  'client_body_in_single_buffer|hsl|client_body_in_single_buffer on|off;|Giữ body trong một buffer duy nhất.',
  'client_header_buffer_size|hs|client_header_buffer_size kích_thước;|Bộ đệm đọc header request.',
  'client_header_timeout|hs|client_header_timeout thời_gian;|Timeout đọc header request.',
  'large_client_header_buffers|hs|large_client_header_buffers số kích_thước;|Bộ đệm cho header/URL lớn (vượt → 414/400).',
  'ignore_invalid_headers|hs|ignore_invalid_headers on|off;|Bỏ qua header có tên không hợp lệ.',
  'underscores_in_headers|hs|underscores_in_headers on|off;|Cho phép dấu "_" trong tên header client.',
  'merge_slashes|hs|merge_slashes on|off;|Gộp nhiều dấu "/" liên tiếp trong URI.',
  'request_pool_size|hs|request_pool_size kích_thước;|Kích thước pool bộ nhớ mỗi request.',
  'connection_pool_size|hs|connection_pool_size kích_thước;|Kích thước pool bộ nhớ mỗi kết nối.',
  'server_tokens|hsl|server_tokens on|off|build|string;|Hiện/ẩn phiên bản nginx trong header Server và trang lỗi.',
  'server_names_hash_bucket_size|h|server_names_hash_bucket_size số;|Kích thước bucket bảng băm server_name (tăng khi tên rất dài).',
  'server_names_hash_max_size|h|server_names_hash_max_size số;|Kích thước tối đa bảng băm server_name.',
  'variables_hash_max_size|h|variables_hash_max_size số;|Kích thước tối đa bảng băm biến.',
  'variables_hash_bucket_size|h|variables_hash_bucket_size số;|Kích thước bucket bảng băm biến.',
  'types_hash_max_size|hsl|types_hash_max_size số;|Kích thước tối đa bảng băm MIME types.',
  'types_hash_bucket_size|hsl|types_hash_bucket_size số;|Kích thước bucket bảng băm MIME types.',
  'map_hash_max_size|h|map_hash_max_size số;|Kích thước tối đa bảng băm của map.',
  'map_hash_bucket_size|h|map_hash_bucket_size số;|Kích thước bucket bảng băm của map.',
  'server_name_in_redirect|hsl|server_name_in_redirect on|off;|Dùng server_name chính trong redirect do nginx sinh ra.',
  'port_in_redirect|hsl|port_in_redirect on|off;|Có kèm cổng trong redirect do nginx sinh ra.',
  'absolute_redirect|hsl|absolute_redirect on|off;|Redirect tuyệt đối (có scheme+host) hay tương đối.',
  'recursive_error_pages|hsl|recursive_error_pages on|off;|Cho phép error_page lồng nhau.',
  'log_not_found|hsl|log_not_found on|off;|Ghi error_log khi không tìm thấy file (thường tắt cho favicon/robots).',
  'log_subrequest|hsl|log_subrequest on|off;|Ghi access_log cả subrequest.',
  'msie_padding|hsl|msie_padding on|off;|Độn trang lỗi cho IE cũ.',
  'msie_refresh|hsl|msie_refresh on|off;|Dùng refresh thay redirect 3xx cho IE cũ.',
  'if_modified_since|hsl|if_modified_since off|exact|before;|Cách so sánh If-Modified-Since.',
  'etag|hsl|etag on|off;|Sinh header ETag cho file tĩnh.',
  'expires|hsl|expires [modified] thời_gian|epoch|max|off;|Đặt Expires và Cache-Control: max-age.',
  'add_header|hsl|add_header tên giá_trị [always];|Thêm header phản hồi. Chỉ kế thừa nếu cấp hiện tại không có add_header nào.',
  'add_trailer|hsl|add_trailer tên giá_trị [always];|Thêm trailer vào cuối phản hồi.',
  'max_ranges|hsl|max_ranges số;|Số range tối đa của request Range (0 = tắt byte-range).',
  'chunked_transfer_encoding|hsl|chunked_transfer_encoding on|off;|Bật chunked cho HTTP/1.1.',
  'charset|hsl|charset mã|off;|Thêm charset vào Content-Type.',
  'source_charset|hsl|source_charset mã;|Charset gốc của phản hồi.',
  'override_charset|hsl|override_charset on|off;|Ghi đè charset do backend trả về.',
  'disable_symlinks|hsl|disable_symlinks off|on|if_not_owner;|Kiểm soát việc đi theo symlink khi mở file.',
  'directio|hsl|directio kích_thước|off;|Đọc file lớn bằng direct I/O (bỏ qua page cache).',
  'directio_alignment|hsl|directio_alignment kích_thước;|Căn chỉnh khi dùng directio.',
  'aio|hsl|aio on|off|threads[=pool];|Bật I/O bất đồng bộ.',
  'read_ahead|hsl|read_ahead kích_thước;|Đọc trước dữ liệu file.',
  'output_buffers|hsl|output_buffers số kích_thước;|Bộ đệm đọc file trước khi gửi.',
  'postpone_output|hsl|postpone_output kích_thước;|Hoãn gửi cho tới khi đủ dữ liệu.',
  'resolver|hslu|resolver địa_chỉ... [valid=thời_gian] [ipv6=off];|DNS server để phân giải tên động (proxy_pass biến, OCSP...).',
  'resolver_timeout|hslu|resolver_timeout thời_gian;|Timeout phân giải DNS.',
  'open_file_cache|hsl|open_file_cache max=N [inactive=T]|off;|Cache descriptor/metadata file đã mở.',
  'open_file_cache_valid|hsl|open_file_cache_valid thời_gian;|Chu kỳ kiểm tra lại thông tin file trong cache.',
  'open_file_cache_min_uses|hsl|open_file_cache_min_uses số;|Số lần dùng tối thiểu để giữ trong cache.',
  'open_file_cache_errors|hsl|open_file_cache_errors on|off;|Cache cả lỗi tìm file.',
  'access_log|hsl|access_log đường_dẫn [định_dạng [buffer=..]]|off;|Ghi log truy cập; "off" để tắt.',
  'error_log|mhsl|error_log file [mức];|File log lỗi và mức (debug, info, notice, warn, error, crit...).',
  'log_format|h|log_format tên [escape=json] chuỗi...;|Định nghĩa định dạng dòng access log.',
  'open_log_file_cache|hsl|open_log_file_cache max=N ...|off;|Cache descriptor của file log có tên chứa biến.',
  'mirror|hsl|mirror uri|off;|Sao chép request sang URI khác (shadow traffic).',
  'mirror_request_body|hsl|mirror_request_body on|off;|Gửi cả body khi mirror.',
  'slice|hsl|slice kích_thước;|Chia phản hồi lớn thành các mảnh (cache theo byte-range).',
  'mp4|l|mp4;|Hỗ trợ tua video MP4 (pseudo-streaming).',
  'flv|l|flv;|Hỗ trợ tua video FLV.',
  'stub_status|l|stub_status;|Trang thống kê kết nối cơ bản (nên giới hạn IP).',
  'empty_gif|l|empty_gif;|Trả về ảnh GIF 1x1 trong suốt.',
  'ssi|hsl|ssi on|off;|Xử lý Server Side Includes.',
  'ssi_types|hsl|ssi_types mime...;|MIME được xử lý SSI.',
  'sub_filter|hsl|sub_filter chuỗi thay_thế;|Thay chuỗi trong nội dung phản hồi.',
  'sub_filter_once|hsl|sub_filter_once on|off;|Chỉ thay lần đầu tiên.',
  'sub_filter_types|hsl|sub_filter_types mime...;|MIME áp dụng sub_filter.',
  'sub_filter_last_modified|hsl|sub_filter_last_modified on|off;|Giữ Last-Modified khi sub_filter.',
  'limit_rate|hsl|limit_rate tốc_độ;|Giới hạn băng thông mỗi kết nối (byte/giây).',
  'limit_rate_after|hsl|limit_rate_after kích_thước;|Chỉ giới hạn tốc độ sau khi đã gửi chừng này dữ liệu.',
  'valid_referers|sl|valid_referers none|blocked|server_names|chuỗi...;|Khai báo Referer hợp lệ ($invalid_referer).',
  'referer_hash_bucket_size|sl|referer_hash_bucket_size số;|Kích thước bucket băm referer.',
  'set_real_ip_from|hsl|set_real_ip_from địa_chỉ|CIDR;|Proxy/CDN tin cậy được phép báo IP thật của client.',
  'real_ip_header|hsl|real_ip_header field|X-Real-IP|X-Forwarded-For|proxy_protocol;|Header chứa IP thật của client.',
  'real_ip_recursive|hsl|real_ip_recursive on|off;|Duyệt đệ quy X-Forwarded-For từ phải sang trái.',
  // --- nén ---
  'gzip|hsl|gzip on|off;|Bật nén gzip phản hồi.',
  'gzip_types|hsl|gzip_types mime...;|MIME types được nén (text/html luôn được nén).',
  'gzip_min_length|hsl|gzip_min_length byte;|Không nén phản hồi nhỏ hơn ngưỡng này.',
  'gzip_comp_level|hsl|gzip_comp_level 1-9;|Mức nén (4-6 là cân bằng).',
  'gzip_vary|hsl|gzip_vary on|off;|Thêm "Vary: Accept-Encoding" (cần thiết cho cache/CDN).',
  'gzip_proxied|hsl|gzip_proxied off|expired|no-cache|...|any;|Nén cả phản hồi cho request đến qua proxy (có Via).',
  'gzip_disable|hsl|gzip_disable regex...;|Tắt nén cho User-Agent khớp regex.',
  'gzip_buffers|hsl|gzip_buffers số kích_thước;|Bộ đệm nén.',
  'gzip_http_version|hsl|gzip_http_version 1.0|1.1;|Phiên bản HTTP tối thiểu để nén.',
  'gzip_static|hsl|gzip_static on|off|always;|Phục vụ file .gz nén sẵn nếu có.',
  'gunzip|hsl|gunzip on|off;|Giải nén phản hồi gzip cho client không hỗ trợ.',
  'brotli|hsl|brotli on|off;|Bật nén Brotli (module ngx_brotli, không có sẵn).',
  'brotli_types|hsl|brotli_types mime...;|MIME types nén Brotli.',
  'brotli_comp_level|hsl|brotli_comp_level 0-11;|Mức nén Brotli (4-6 cân bằng khi nén động).',
  'brotli_min_length|hsl|brotli_min_length byte;|Ngưỡng kích thước tối thiểu để nén Brotli.',
  'brotli_static|hsl|brotli_static on|off|always;|Phục vụ file .br nén sẵn.',
  'brotli_buffers|hsl|brotli_buffers số kích_thước;|Bộ đệm Brotli.',
  'brotli_window|hsl|brotli_window kích_thước;|Kích thước cửa sổ Brotli.',
  // --- SSL / TLS ---
  'ssl_certificate|hs|ssl_certificate file;|Chứng chỉ (fullchain) dạng PEM.',
  'ssl_certificate_key|hs|ssl_certificate_key file;|Khoá riêng tương ứng chứng chỉ.',
  'ssl_protocols|hs|ssl_protocols [SSLv3] [TLSv1] [TLSv1.1] [TLSv1.2] [TLSv1.3];|Các phiên bản TLS cho phép (khuyến nghị TLSv1.2 TLSv1.3).',
  'ssl_ciphers|hs|ssl_ciphers chuỗi;|Danh sách cipher suite (TLS 1.2 trở xuống).',
  'ssl_prefer_server_ciphers|hs|ssl_prefer_server_ciphers on|off;|Ưu tiên thứ tự cipher của server. Mozilla intermediate: off.',
  'ssl_ecdh_curve|hs|ssl_ecdh_curve đường_cong[:...];|Các đường cong ECDH.',
  'ssl_dhparam|hs|ssl_dhparam file;|Tham số Diffie-Hellman cho cipher DHE.',
  'ssl_session_cache|hs|ssl_session_cache off|none|builtin[:N]|shared:tên:kích_thước;|Cache phiên TLS để resume nhanh.',
  'ssl_session_timeout|hs|ssl_session_timeout thời_gian;|Thời gian sống của phiên TLS đã cache.',
  'ssl_session_tickets|hs|ssl_session_tickets on|off;|Session tickets (tắt để đảm bảo forward secrecy).',
  'ssl_session_ticket_key|hs|ssl_session_ticket_key file;|Khoá mã hoá session ticket.',
  'ssl_stapling|hs|ssl_stapling on|off;|OCSP stapling (cần chứng chỉ có OCSP URL; Let\'s Encrypt đã ngừng OCSP).',
  'ssl_stapling_verify|hs|ssl_stapling_verify on|off;|Xác minh phản hồi OCSP (cần ssl_trusted_certificate).',
  'ssl_stapling_file|hs|ssl_stapling_file file;|File phản hồi OCSP dựng sẵn.',
  'ssl_stapling_responder|hs|ssl_stapling_responder url;|Ghi đè URL OCSP responder.',
  'ssl_trusted_certificate|hs|ssl_trusted_certificate file;|Chuỗi CA tin cậy (để xác minh OCSP / client cert).',
  'ssl_client_certificate|hs|ssl_client_certificate file;|CA dùng để xác thực chứng chỉ client (mTLS).',
  'ssl_verify_client|hs|ssl_verify_client on|off|optional|optional_no_ca;|Yêu cầu chứng chỉ client (mTLS).',
  'ssl_verify_depth|hs|ssl_verify_depth số;|Độ sâu tối đa khi xác minh chuỗi chứng chỉ.',
  'ssl_crl|hs|ssl_crl file;|Danh sách thu hồi chứng chỉ (CRL).',
  'ssl_buffer_size|hs|ssl_buffer_size kích_thước;|Kích thước bộ đệm ghi TLS (nhỏ hơn → TTFB tốt hơn).',
  'ssl_early_data|hs|ssl_early_data on|off;|Cho phép TLS 1.3 0-RTT (có rủi ro replay).',
  'ssl_reject_handshake|hs|ssl_reject_handshake on|off;|Từ chối handshake (dùng cho default server chặn host lạ).',
  'ssl_conf_command|hs|ssl_conf_command tên giá_trị;|Truyền lệnh trực tiếp cho OpenSSL.',
  'ssl_password_file|hs|ssl_password_file file;|File chứa passphrase khoá riêng.',
  'ssl_verify_client_cert|hs|ssl_verify_client_cert on|off;|Biến thể xác thực client cert.',
  'http2|hs|http2 on|off;|Bật HTTP/2 (nginx >= 1.25.1; thay cho "listen ... http2").',
  'http2_max_concurrent_streams|hs|http2_max_concurrent_streams số;|Số stream đồng thời tối đa mỗi kết nối HTTP/2.',
  'http2_idle_timeout|hs|http2_idle_timeout thời_gian;|(đã lỗi thời) timeout nhàn rỗi HTTP/2.',
  'http3|hs|http3 on|off;|Bật HTTP/3 (cần build có http_v3_module, listen ... quic).',
  'http3_hq|hs|http3_hq on|off;|Bật giao thức hq-interop (thử nghiệm).',
  'http3_max_concurrent_streams|hs|http3_max_concurrent_streams số;|Số stream đồng thời tối đa HTTP/3.',
  'http3_stream_buffer_size|hs|http3_stream_buffer_size kích_thước;|Bộ đệm stream HTTP/3.',
  'quic_retry|hs|quic_retry on|off;|Bật address validation (Retry) của QUIC.',
  'quic_gso|hs|quic_gso on|off;|Bật Generic Segmentation Offload cho QUIC.',
  'quic_host_key|hs|quic_host_key file;|Khoá để sinh token QUIC.',
  'quic_bpf|h|quic_bpf on|off;|Dùng eBPF định tuyến gói QUIC (Linux).',
  // --- proxy ---
  'proxy_pass|l|proxy_pass URL;|Chuyển tiếp request tới backend. Có phần URI (kể cả "/") → thay phần location khớp.',
  'proxy_set_header|hsl|proxy_set_header tên giá_trị;|Đặt header gửi tới backend. Chỉ kế thừa nếu cấp hiện tại không có proxy_set_header nào.',
  'proxy_hide_header|hsl|proxy_hide_header tên;|Ẩn header của backend khỏi phản hồi cho client.',
  'proxy_pass_header|hsl|proxy_pass_header tên;|Cho phép chuyển tiếp header vốn bị ẩn (Server, Date...).',
  'proxy_pass_request_headers|hsl|proxy_pass_request_headers on|off;|Chuyển header request gốc tới backend.',
  'proxy_pass_request_body|hsl|proxy_pass_request_body on|off;|Chuyển body request gốc tới backend.',
  'proxy_set_body|hsl|proxy_set_body giá_trị;|Thay body gửi tới backend.',
  'proxy_method|hsl|proxy_method method;|Ép method HTTP gửi tới backend.',
  'proxy_http_version|hsl|proxy_http_version 1.0|1.1;|Phiên bản HTTP tới backend (cần 1.1 cho keepalive/WebSocket).',
  'proxy_connect_timeout|hsl|proxy_connect_timeout thời_gian;|Timeout kết nối tới backend (mặc định 60s).',
  'proxy_read_timeout|hsl|proxy_read_timeout thời_gian;|Timeout giữa hai lần đọc từ backend (mặc định 60s).',
  'proxy_send_timeout|hsl|proxy_send_timeout thời_gian;|Timeout giữa hai lần ghi tới backend (mặc định 60s).',
  'proxy_buffering|hsl|proxy_buffering on|off;|Bộ đệm phản hồi backend; tắt cho SSE/streaming.',
  'proxy_buffers|hsl|proxy_buffers số kích_thước;|Số và kích thước bộ đệm phản hồi.',
  'proxy_buffer_size|hsl|proxy_buffer_size kích_thước;|Bộ đệm cho phần đầu phản hồi (header).',
  'proxy_busy_buffers_size|hsl|proxy_busy_buffers_size kích_thước;|Giới hạn buffer đang gửi cho client.',
  'proxy_max_temp_file_size|hsl|proxy_max_temp_file_size kích_thước;|Giới hạn file tạm khi phản hồi vượt buffer.',
  'proxy_temp_file_write_size|hsl|proxy_temp_file_write_size kích_thước;|Lượng ghi mỗi lần vào file tạm.',
  'proxy_request_buffering|hsl|proxy_request_buffering on|off;|Đệm toàn bộ body request trước khi gửi tới backend.',
  'proxy_redirect|hsl|proxy_redirect mặc_định|off|từ tới;|Viết lại header Location/Refresh của backend.',
  'proxy_cookie_domain|hsl|proxy_cookie_domain off|domain thay;|Viết lại thuộc tính domain của Set-Cookie.',
  'proxy_cookie_path|hsl|proxy_cookie_path off|path thay;|Viết lại thuộc tính path của Set-Cookie.',
  'proxy_cache|hsl|proxy_cache zone|off;|Bật cache proxy với vùng nhớ đã khai báo.',
  'proxy_cache_path|h|proxy_cache_path đường_dẫn keys_zone=tên:kích_thước [...];|Khai báo vùng và thư mục cache proxy.',
  'proxy_cache_key|hsl|proxy_cache_key chuỗi;|Khoá cache (mặc định $scheme$proxy_host$request_uri).',
  'proxy_cache_valid|hsl|proxy_cache_valid [code...] thời_gian;|Thời gian cache theo mã trạng thái.',
  'proxy_cache_use_stale|hsl|proxy_cache_use_stale error|timeout|updating|...;|Dùng bản cache cũ khi backend lỗi.',
  'proxy_cache_bypass|hsl|proxy_cache_bypass điều_kiện...;|Không lấy từ cache khi điều kiện đúng.',
  'proxy_no_cache|hsl|proxy_no_cache điều_kiện...;|Không lưu phản hồi vào cache khi điều kiện đúng.',
  'proxy_cache_lock|hsl|proxy_cache_lock on|off;|Chỉ một request nạp cache cho cùng khoá (chống cache stampede).',
  'proxy_cache_min_uses|hsl|proxy_cache_min_uses số;|Số lần request tối thiểu trước khi cache.',
  'proxy_cache_methods|hsl|proxy_cache_methods GET|HEAD|POST...;|Method được cache.',
  'proxy_cache_revalidate|hsl|proxy_cache_revalidate on|off;|Dùng If-Modified-Since để làm mới cache.',
  'proxy_cache_background_update|hsl|proxy_cache_background_update on|off;|Cập nhật cache cũ ở nền.',
  'proxy_ignore_headers|hsl|proxy_ignore_headers tên...;|Bỏ qua header của backend (Cache-Control, Expires, Set-Cookie...).',
  'proxy_next_upstream|hsl|proxy_next_upstream error|timeout|http_502|...;|Khi nào thử backend kế tiếp.',
  'proxy_next_upstream_tries|hsl|proxy_next_upstream_tries số;|Số lần thử backend tối đa.',
  'proxy_next_upstream_timeout|hsl|proxy_next_upstream_timeout thời_gian;|Tổng thời gian tối đa để thử các backend.',
  'proxy_intercept_errors|hsl|proxy_intercept_errors on|off;|Cho error_page xử lý mã lỗi >= 300 từ backend.',
  'proxy_ssl_server_name|hsl|proxy_ssl_server_name on|off;|Gửi SNI khi proxy tới backend HTTPS.',
  'proxy_ssl_name|hsl|proxy_ssl_name tên;|Tên server dùng khi xác minh chứng chỉ backend.',
  'proxy_ssl_verify|hsl|proxy_ssl_verify on|off;|Xác minh chứng chỉ backend HTTPS.',
  'proxy_ssl_trusted_certificate|hsl|proxy_ssl_trusted_certificate file;|CA tin cậy để xác minh backend.',
  'proxy_ssl_protocols|hsl|proxy_ssl_protocols ...;|Phiên bản TLS cho kết nối tới backend.',
  'proxy_ssl_session_reuse|hsl|proxy_ssl_session_reuse on|off;|Tái sử dụng phiên TLS tới backend.',
  'proxy_ssl_certificate|hsl|proxy_ssl_certificate file;|Chứng chỉ client gửi tới backend (mTLS).',
  'proxy_ssl_certificate_key|hsl|proxy_ssl_certificate_key file;|Khoá riêng của chứng chỉ client tới backend.',
  'proxy_bind|hsl|proxy_bind địa_chỉ|off;|Địa chỉ IP nguồn khi kết nối tới backend.',
  'proxy_socket_keepalive|hsl|proxy_socket_keepalive on|off;|Bật SO_KEEPALIVE tới backend.',
  'proxy_force_ranges|hsl|proxy_force_ranges on|off;|Bật byte-range cho phản hồi proxied.',
  'proxy_store|hsl|proxy_store on|off|đường_dẫn;|Lưu bản sao file từ backend ra đĩa.',
  'proxy_headers_hash_max_size|hsl|proxy_headers_hash_max_size số;|Kích thước bảng băm header proxy.',
  'proxy_protocol|*|proxy_protocol on|off;|Gửi PROXY protocol tới backend (stream).',
  // --- fastcgi / uwsgi / scgi / grpc / memcached ---
  'fastcgi_pass|l|fastcgi_pass địa_chỉ;|Chuyển request tới FastCGI (PHP-FPM): unix:/run/php/php-fpm.sock hoặc host:9000.',
  'fastcgi_param|hsl|fastcgi_param tham_số giá_trị;|Truyền tham số FastCGI (SCRIPT_FILENAME...).',
  'fastcgi_index|hsl|fastcgi_index file;|File index nối vào URI kết thúc bằng "/".',
  'fastcgi_split_path_info|sl|fastcgi_split_path_info regex;|Tách SCRIPT_NAME và PATH_INFO.',
  'fastcgi_intercept_errors|hsl|fastcgi_intercept_errors on|off;|Cho error_page xử lý lỗi từ FastCGI.',
  'fastcgi_read_timeout|hsl|fastcgi_read_timeout thời_gian;|Timeout đọc phản hồi FastCGI.',
  'fastcgi_send_timeout|hsl|fastcgi_send_timeout thời_gian;|Timeout gửi request tới FastCGI.',
  'fastcgi_connect_timeout|hsl|fastcgi_connect_timeout thời_gian;|Timeout kết nối tới FastCGI.',
  'fastcgi_buffers|hsl|fastcgi_buffers số kích_thước;|Bộ đệm phản hồi FastCGI.',
  'fastcgi_buffer_size|hsl|fastcgi_buffer_size kích_thước;|Bộ đệm cho phần đầu phản hồi FastCGI.',
  'fastcgi_busy_buffers_size|hsl|fastcgi_busy_buffers_size kích_thước;|Giới hạn buffer đang gửi (FastCGI).',
  'fastcgi_hide_header|hsl|fastcgi_hide_header tên;|Ẩn header của FastCGI.',
  'fastcgi_pass_header|hsl|fastcgi_pass_header tên;|Chuyển tiếp header bị ẩn của FastCGI.',
  'fastcgi_keep_conn|hsl|fastcgi_keep_conn on|off;|Giữ kết nối tới FastCGI.',
  'fastcgi_ignore_client_abort|hsl|fastcgi_ignore_client_abort on|off;|Tiếp tục chạy khi client ngắt kết nối.',
  'fastcgi_cache|hsl|fastcgi_cache zone|off;|Bật cache FastCGI.',
  'fastcgi_cache_path|h|fastcgi_cache_path đường_dẫn keys_zone=...;|Khai báo vùng cache FastCGI.',
  'fastcgi_cache_key|hsl|fastcgi_cache_key chuỗi;|Khoá cache FastCGI.',
  'fastcgi_cache_valid|hsl|fastcgi_cache_valid [code] thời_gian;|Thời gian cache FastCGI.',
  'uwsgi_pass|l|uwsgi_pass địa_chỉ;|Chuyển request tới uWSGI.',
  'uwsgi_param|hsl|uwsgi_param tham_số giá_trị;|Truyền tham số uWSGI.',
  'uwsgi_read_timeout|hsl|uwsgi_read_timeout thời_gian;|Timeout đọc phản hồi uWSGI.',
  'scgi_pass|l|scgi_pass địa_chỉ;|Chuyển request tới SCGI.',
  'scgi_param|hsl|scgi_param tham_số giá_trị;|Truyền tham số SCGI.',
  'grpc_pass|l|grpc_pass địa_chỉ;|Chuyển request tới backend gRPC.',
  'grpc_set_header|hsl|grpc_set_header tên giá_trị;|Đặt header gửi tới backend gRPC.',
  'grpc_read_timeout|hsl|grpc_read_timeout thời_gian;|Timeout đọc phản hồi gRPC.',
  'grpc_send_timeout|hsl|grpc_send_timeout thời_gian;|Timeout gửi request gRPC.',
  'grpc_ssl_verify|hsl|grpc_ssl_verify on|off;|Xác minh chứng chỉ backend gRPC.',
  'memcached_pass|l|memcached_pass địa_chỉ;|Lấy nội dung từ memcached.',
  // --- upstream ---
  'zone|u|zone tên [kích_thước];|Vùng nhớ chia sẻ giữa các worker cho upstream.',
  'least_conn|u|least_conn;|Chọn backend có ít kết nối đang hoạt động nhất.',
  'ip_hash|u|ip_hash;|Cùng IP client luôn tới cùng backend (sticky theo IP).',
  'hash|u|hash khoá [consistent];|Chọn backend theo băm của khoá tuỳ ý.',
  'random|u|random [two [least_conn]];|Chọn backend ngẫu nhiên.',
  'least_time|u|least_time header|last_byte;|Chọn backend phản hồi nhanh nhất (nginx Plus).',
  'keepalive|u|keepalive số;|Số kết nối rảnh giữ tới backend (cần proxy_http_version 1.1 + Connection "").',
  'ntlm|u|ntlm;|Giữ kết nối cho xác thực NTLM (Plus).',
  'sticky|u|sticky cookie ...;|Phiên dính (Plus).',
  'queue|u|queue số [timeout=..];|Hàng đợi khi hết kết nối backend (Plus).',
  'state|u|state file;|File lưu trạng thái upstream (Plus).',
  'health_check|l|health_check [tham_số];|Health check chủ động (nginx Plus).',
  // --- giới hạn truy cập ---
  'limit_req_zone|h|limit_req_zone khoá zone=tên:kích_thước rate=Nr/s|m;|Khai báo vùng và tốc độ giới hạn request.',
  'limit_req|hsl|limit_req zone=tên [burst=N] [nodelay|delay=M];|Áp dụng giới hạn tốc độ request theo zone.',
  'limit_req_status|hsl|limit_req_status code;|Mã trả về khi bị giới hạn (mặc định 503; nên dùng 429).',
  'limit_req_log_level|hsl|limit_req_log_level info|notice|warn|error;|Mức log khi từ chối request.',
  'limit_req_dry_run|hsl|limit_req_dry_run on|off;|Chỉ ghi log, không thực sự chặn.',
  'limit_conn_zone|h|limit_conn_zone khoá zone=tên:kích_thước;|Khai báo vùng giới hạn số kết nối.',
  'limit_conn|hsl|limit_conn zone số;|Giới hạn số kết nối đồng thời theo zone.',
  'limit_conn_status|hsl|limit_conn_status code;|Mã trả về khi vượt giới hạn kết nối.',
  'limit_conn_log_level|hsl|limit_conn_log_level mức;|Mức log khi từ chối kết nối.',
  'limit_conn_dry_run|hsl|limit_conn_dry_run on|off;|Chỉ ghi log, không chặn.',
  // --- thư viện bổ sung ---
  'userid|hsl|userid on|v1|log|off;|Đặt cookie định danh client.',
  'random_index|l|random_index on|off;|Chọn file index ngẫu nhiên.',
  'secure_link|hsl|secure_link biểu_thức;|Kiểm tra link có chữ ký/hết hạn.',
  'secure_link_md5|hsl|secure_link_md5 biểu_thức;|Biểu thức MD5 cho secure_link.',
  'secure_link_secret|l|secure_link_secret từ_khoá;|Khoá bí mật cho secure_link.',
  'image_filter|l|image_filter resize|crop|rotate...;|Biến đổi ảnh (resize, crop...).',
  'dav_methods|hsl|dav_methods PUT|DELETE|MKCOL...;|Bật các method WebDAV.',
  'geoip_country|h|geoip_country file;|CSDL GeoIP quốc gia (legacy).',
  'perl|l|perl module::function;|Chạy handler Perl.',
  'js_import|hs|js_import module;|Nạp module njs.',
  'js_content|l|js_content hàm;|Handler njs tạo nội dung phản hồi.',
  'js_set|hs|js_set $biến hàm;|Biến tính bằng njs.',
  'status_zone|sl|status_zone tên;|Vùng thống kê (Plus).',
];

const DICT: Record<string, DirectiveInfo> = {};
const DICT_NAMES: string[] = [];

(function buildDict() {
  for (const row of DICT_RAW) {
    // desc có thể chứa '|' trong syntax, nên: name | ctx | ... (syntax gồm cả các '|') ... | desc (phần tử cuối)
    const parts = row.split('|');
    if (parts.length < 4) continue;
    const name = parts[0];
    const ctxStr = parts[1];
    const desc = parts[parts.length - 1];
    const syntax = parts.slice(2, parts.length - 1).join('|');
    const contexts: string[] = [];
    if (ctxStr === '*') contexts.push('*');
    else for (const ch of ctxStr) if (CTX_LETTER[ch]) contexts.push(CTX_LETTER[ch]);
    DICT[name] = { name, contexts, syntax, desc };
    DICT_NAMES.push(name);
  }
})();

export function getDirectiveInfo(name: string): DirectiveInfo | undefined {
  return Object.prototype.hasOwnProperty.call(DICT, name) ? DICT[name] : undefined;
}

export function directiveCount(): number {
  return DICT_NAMES.length;
}

export function allDirectives(): DirectiveInfo[] {
  return DICT_NAMES.map((n) => DICT[n]);
}

/** Directive đã bị loại bỏ → lý do + cách thay thế */
const DEPRECATED: Record<string, string> = {
  ssl: 'Directive "ssl on" đã bị loại bỏ từ nginx 1.15.0; hãy dùng "listen 443 ssl;" thay thế.',
  spdy: 'SPDY đã bị loại bỏ; dùng HTTP/2 ("http2 on;").',
  http2_push: 'HTTP/2 Server Push đã bị loại bỏ (nginx 1.25.1).',
  http2_push_preload: 'HTTP/2 Server Push đã bị loại bỏ (nginx 1.25.1).',
  optimize_server_names: 'Directive này đã bị loại bỏ.',
  limit_zone: 'limit_zone đã bị loại bỏ; dùng limit_conn_zone.',
};

/** Tiền tố của các module/bên thứ ba thường gặp: không báo "sai chính tả" nếu không có trong từ điển */
const MODULE_PREFIXES = [
  'proxy', 'fastcgi', 'uwsgi', 'scgi', 'grpc', 'memcached', 'ssl', 'http2', 'http3', 'quic', 'gzip', 'brotli',
  'limit', 'auth', 'lua', 'js', 'perl', 'geoip', 'geoip2', 'image', 'xslt', 'ssi', 'sub', 'mp4', 'flv', 'dav',
  'mirror', 'rtmp', 'hls', 'dash', 'modsecurity', 'more', 'vhost', 'push', 'fancyindex', 'zone', 'health',
  'keyval', 'f4f', 'userid', 'session', 'sticky', 'secure', 'set', 'content', 'access', 'rewrite', 'header',
  'body', 'init', 'log', 'naxsi', 'ts', 'ajp', 'echo', 'srcache', 'redis', 'upload', 'headers', 'ngx', 'stream',
  'upstream', 'api', 'status', 'ntlm', 'jwt', 'oidc', 'waf', 'cache', 'resolver', 'ocsp',
];

/* ========================================================================== */
/* 2. TOKENIZER + PARSER                                                      */
/* ========================================================================== */

export type Severity = 'error' | 'warn' | 'info';

export interface Issue {
  rule: string;
  severity: Severity;
  line: number;
  col: number;
  message: string;
  hint?: string;
}

export interface Arg {
  value: string;
  quoted: boolean;
  line: number;
  col: number;
}

export interface NginxNode {
  name: string;
  args: Arg[];
  line: number;
  col: number;
  endLine: number;
  /** undefined = directive thường (kết thúc bằng ;), mảng = block */
  children?: NginxNode[];
  parent?: NginxNode;
  /** true nếu nằm trong block không lint nội dung (map, geo, types...) */
  opaque?: boolean;
}

interface Tok {
  kind: 'word' | 'lbrace' | 'rbrace' | 'semi';
  text: string;
  quoted: boolean;
  line: number;
  col: number;
  endLine: number;
  endCol: number;
}

export const MAX_CONFIG_CHARS = 1_000_000;
const MAX_TOKENS = 250_000;
const MAX_DEPTH = 64;

function pushIssue(list: Issue[], rule: string, severity: Severity, line: number, col: number, message: string, hint?: string) {
  list.push({ rule, severity, line, col, message, hint });
}

export function tokenize(src: string): { tokens: Tok[]; issues: Issue[] } {
  const tokens: Tok[] = [];
  const issues: Issue[] = [];
  const n = src.length;
  let i = 0;
  let line = 1;
  let col = 1;
  const adv = () => {
    const c = src[i++];
    if (c === '\n') {
      line++;
      col = 1;
    } else col++;
    return c;
  };
  const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === ' ' || c === '﻿';

  while (i < n) {
    if (tokens.length > MAX_TOKENS) {
      pushIssue(issues, 'syntax', 'error', line, col, 'File quá lớn (quá nhiều token); dừng phân tích tại đây.');
      break;
    }
    const c = src[i];
    if (isSpace(c)) {
      adv();
      continue;
    }
    if (c === '#') {
      while (i < n && src[i] !== '\n') adv();
      continue;
    }
    const sl = line;
    const sc = col;
    if (c === '{' || c === '}' || c === ';') {
      adv();
      tokens.push({ kind: c === '{' ? 'lbrace' : c === '}' ? 'rbrace' : 'semi', text: c, quoted: false, line: sl, col: sc, endLine: line, endCol: col });
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      adv();
      let val = '';
      let closed = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\' && i + 1 < n) {
          const nx = src[i + 1];
          adv();
          adv();
          if (nx === '"' || nx === "'" || nx === '\\') val += nx;
          else if (nx === 'n') val += '\n';
          else if (nx === 't') val += '\t';
          else if (nx === 'r') val += '\r';
          else val += '\\' + nx;
          continue;
        }
        if (ch === q) {
          adv();
          closed = true;
          break;
        }
        val += adv();
      }
      if (!closed) {
        pushIssue(issues, 'syntax', 'error', sl, sc, `Chuỗi trích dẫn (${q}) mở ở dòng ${sl} cột ${sc} không có dấu đóng.`, 'Thêm dấu nháy đóng, hoặc escape dấu nháy bên trong bằng \\.');
        tokens.push({ kind: 'word', text: val, quoted: true, line: sl, col: sc, endLine: line, endCol: col });
        break;
      }
      tokens.push({ kind: 'word', text: val, quoted: true, line: sl, col: sc, endLine: line, endCol: col });
      if (i < n) {
        const nx = src[i];
        if (!isSpace(nx) && nx !== ';' && nx !== '{' && nx !== '}' && nx !== ')') {
          pushIssue(issues, 'syntax', 'error', line, col, `Thiếu khoảng trắng sau chuỗi trích dẫn (gặp "${nx}").`, 'nginx yêu cầu dấu cách, ";" hoặc "{" ngay sau chuỗi trong nháy.');
        }
      }
      continue;
    }
    // từ trần
    let val = '';
    while (i < n) {
      const ch = src[i];
      if (isSpace(ch) || ch === ';' || ch === '{' || ch === '}') break;
      if (ch === '$' && src[i + 1] === '{') {
        // ${var}
        val += adv();
        val += adv();
        while (i < n && src[i] !== '}' && src[i] !== '\n') val += adv();
        if (i < n && src[i] === '}') val += adv();
        continue;
      }
      val += adv();
    }
    tokens.push({ kind: 'word', text: val, quoted: false, line: sl, col: sc, endLine: line, endCol: col });
  }
  return { tokens, issues };
}

const OPAQUE_BLOCKS = new Set(['map', 'geo', 'split_clients', 'types', 'charset_map', 'match', 'stream', 'mail', 'perl', 'rtmp', 'ts', 'js', 'lua']);
/** từ vừa là directive vừa hay là tham số → không dùng cho phát hiện thiếu ; */
const AMBIGUOUS_WORDS = new Set(['break', 'last', 'index', 'random', 'hash', 'zone', 'state', 'queue']);

export interface ParseResult {
  root: NginxNode;
  issues: Issue[];
  lineCount: number;
  truncated: boolean;
}

export function parseNginx(input: string): ParseResult {
  const issues: Issue[] = [];
  let src = input.replace(/\r\n?/g, '\n');
  let truncated = false;
  if (src.length > MAX_CONFIG_CHARS) {
    src = src.slice(0, MAX_CONFIG_CHARS);
    truncated = true;
    pushIssue(issues, 'syntax', 'warn', 1, 1, `Cấu hình quá lớn, chỉ phân tích ${MAX_CONFIG_CHARS.toLocaleString('vi-VN')} ký tự đầu.`);
  }
  const root: NginxNode = { name: '(root)', args: [], line: 1, col: 1, endLine: 1, children: [] };
  const lineCount = src === '' ? 0 : src.split('\n').length;
  try {
    const tk = tokenize(src);
    issues.push(...tk.issues);
    const stack: NginxNode[] = [root];
    let cur: Tok[] = [];
    const top = () => stack[stack.length - 1];
    const inOpaque = () => stack.some((s) => s.opaque || OPAQUE_BLOCKS.has(s.name));

    const toArgs = (ts: Tok[]): Arg[] => ts.map((t) => ({ value: t.text, quoted: t.quoted, line: t.line, col: t.col }));
    const finalizeDirective = () => {
      if (cur.length === 0) return;
      const first = cur[0];
      const node: NginxNode = {
        name: first.text,
        args: toArgs(cur.slice(1)),
        line: first.line,
        col: first.col,
        endLine: cur[cur.length - 1].endLine,
        parent: top(),
        opaque: inOpaque() || undefined,
      };
      top().children!.push(node);
      cur = [];
    };

    for (let ti = 0; ti < tk.tokens.length; ti++) {
      const t = tk.tokens[ti];
      if (t.kind === 'word') {
        if (cur.length > 0 && !inOpaque()) {
          const prev = cur[cur.length - 1];
          // phát hiện thiếu ';' khi một dòng mới bắt đầu bằng directive đã biết
          if (
            t.line > prev.endLine &&
            !t.quoted &&
            !cur[0].quoted &&
            getDirectiveInfo(cur[0].text) &&
            getDirectiveInfo(t.text) &&
            !AMBIGUOUS_WORDS.has(t.text) &&
            !OPAQUE_BLOCKS.has(cur[0].text)
          ) {
            pushIssue(
              issues,
              'syntax',
              'error',
              prev.endLine,
              prev.endCol,
              `Thiếu dấu ";" ở cuối directive "${cur[0].text}" (dòng ${cur[0].line}) — dòng ${t.line} đã bắt đầu directive mới "${t.text}".`,
              'Mọi directive đơn của nginx phải kết thúc bằng dấu chấm phẩy.'
            );
            finalizeDirective();
          }
        }
        cur.push(t);
      } else if (t.kind === 'semi') {
        if (cur.length === 0) {
          pushIssue(issues, 'syntax', 'warn', t.line, t.col, 'Dấu ";" thừa (directive rỗng).', 'nginx báo lỗi "unexpected ;" với dấu chấm phẩy đứng một mình.');
        } else finalizeDirective();
      } else if (t.kind === 'lbrace') {
        if (cur.length === 0) {
          pushIssue(issues, 'syntax', 'error', t.line, t.col, 'Dấu "{" không đi kèm tên directive/block.', 'Ví dụ: server { ... }, location / { ... }.');
          // vẫn mở block ẩn danh để cân bằng ngoặc
          const anon: NginxNode = { name: '(block)', args: [], line: t.line, col: t.col, endLine: t.line, children: [], parent: top(), opaque: true };
          top().children!.push(anon);
          stack.push(anon);
          continue;
        }
        if (stack.length > MAX_DEPTH) {
          pushIssue(issues, 'syntax', 'error', t.line, t.col, `Lồng block quá sâu (> ${MAX_DEPTH} cấp).`);
          cur = [];
          break;
        }
        const first = cur[0];
        const node: NginxNode = {
          name: first.text,
          args: toArgs(cur.slice(1)),
          line: first.line,
          col: first.col,
          endLine: t.line,
          children: [],
          parent: top(),
          opaque: inOpaque() || undefined,
        };
        top().children!.push(node);
        stack.push(node);
        cur = [];
      } else {
        // rbrace
        if (cur.length > 0) {
          const prev = cur[cur.length - 1];
          pushIssue(
            issues,
            'syntax',
            'error',
            prev.endLine,
            prev.endCol,
            `Thiếu dấu ";" sau "${cur[0].text}${cur.length > 1 ? ' ' + cur[cur.length - 1].text : ''}" trước dấu "}" ở dòng ${t.line}.`,
            'Thêm ";" ở cuối directive.'
          );
          finalizeDirective();
        }
        if (stack.length <= 1) {
          pushIssue(issues, 'syntax', 'error', t.line, t.col, 'Dấu "}" dư: không có block nào đang mở.', 'Kiểm tra lại cặp { } — có thể đã đóng block quá sớm.');
        } else {
          const closed = stack.pop()!;
          closed.endLine = t.line;
        }
      }
    }
    if (cur.length > 0) {
      const prev = cur[cur.length - 1];
      pushIssue(issues, 'syntax', 'error', prev.endLine, prev.endCol, `Kết thúc file khi directive "${cur[0].text}" (dòng ${cur[0].line}) chưa có dấu ";".`, 'Thêm ";" ở cuối directive.');
      finalizeDirective();
    }
    while (stack.length > 1) {
      const open = stack.pop()!;
      pushIssue(
        issues,
        'syntax',
        'error',
        open.line,
        open.col,
        `Block "${open.name}${open.args.length ? ' ' + open.args.map((a) => a.value).join(' ') : ''}" mở ở dòng ${open.line} không có dấu "}" đóng.`,
        'Thêm "}" tương ứng ở cuối block.'
      );
      open.endLine = lineCount;
    }
  } catch (e) {
    pushIssue(issues, 'syntax', 'error', 1, 1, 'Lỗi nội bộ khi phân tích: ' + (e instanceof Error ? e.message : String(e)));
  }
  return { root, issues, lineCount, truncated };
}

/* ========================================================================== */
/* 3. LINT                                                                    */
/* ========================================================================== */

const LOC_MODS = new Set(['=', '~', '~*', '^~']);

export interface LocationInfo {
  mod: '' | '=' | '~' | '~*' | '^~';
  path: string;
  named: boolean;
}

export function locationInfo(node: NginxNode): LocationInfo {
  const a = node.args.map((x) => x.value);
  if (a.length >= 2 && LOC_MODS.has(a[0]) && !node.args[0].quoted) {
    return { mod: a[0] as LocationInfo['mod'], path: a[1], named: false };
  }
  const p = a[0] ?? '';
  return { mod: '', path: p, named: p.startsWith('@') };
}

const vals = (n: NginxNode) => n.args.map((a) => a.value);
const hasVar = (s: string) => s.includes('$');

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const suggestCache = new Map<string, string | null>();
function suggestDirective(name: string): string | null {
  if (suggestCache.has(name)) return suggestCache.get(name) ?? null;
  let best: string | null = null;
  let bestD = 3;
  if (name.length >= 4) {
    const max = name.length >= 8 ? 2 : 1;
    for (const d of DICT_NAMES) {
      const dist = levenshtein(name, d, max);
      if (dist <= max && dist < bestD) {
        best = d;
        bestD = dist;
      }
    }
  }
  if (suggestCache.size > 500) suggestCache.clear();
  suggestCache.set(name, best);
  return best;
}

type Ctx = 'main' | 'events' | 'http' | 'server' | 'location' | 'upstream' | 'any';

interface ListenInfo {
  key: string;
  opts: Set<string>;
  rawOpts: string[];
  node: NginxNode;
}

interface ServerRec {
  node: NginxNode;
  listens: ListenInfo[];
  names: string[];
}

function parseListen(node: NginxNode): ListenInfo | null {
  const a = vals(node);
  if (a.length === 0) return null;
  const addr = a[0];
  let key: string;
  if (addr.startsWith('unix:')) key = addr;
  else if (/^\d+$/.test(addr)) key = `*:${addr}`;
  else {
    const m6 = /^\[([^\]]*)\](?::(\d+))?$/.exec(addr);
    if (m6) key = `[${m6[1]}]:${m6[2] ?? '80'}`;
    else {
      const m = /^([^:]+)(?::(\d+))?$/.exec(addr);
      key = m ? `${m[1]}:${m[2] ?? '80'}` : addr;
    }
  }
  const opts = new Set<string>();
  const rawOpts: string[] = [];
  for (const o of a.slice(1)) {
    rawOpts.push(o);
    opts.add(o.split('=')[0]);
  }
  if (opts.has('default')) opts.add('default_server');
  if (opts.has('quic')) key += '/udp';
  return { key, opts, rawOpts, node };
}

function stripPort(host: string): string {
  return host.replace(/:\d+$/, '');
}

/** Tìm directive gần nhất (từ scope hiện tại đi lên) */
function lookup(scope: NginxNode | undefined, name: string): NginxNode | undefined {
  for (let p: NginxNode | undefined = scope; p; p = p.parent) {
    const f = p.children?.find((c) => c.name === name && !c.children);
    if (f) return f;
  }
  return undefined;
}

/** Tập directive cùng loại (add_header/proxy_set_header...) của scope gần nhất có khai báo */
function effectiveSet(scope: NginxNode | undefined, name: string, keyFn: (n: NginxNode) => string): { owner: NginxNode; keys: Set<string> } | null {
  for (let p: NginxNode | undefined = scope; p; p = p.parent) {
    const list = p.children?.filter((c) => c.name === name && !c.children);
    if (list && list.length) return { owner: p, keys: new Set(list.map(keyFn)) };
  }
  return null;
}

const keyLower = (n: NginxNode) => (n.args[0]?.value ?? '').toLowerCase();
const keyUpper = (n: NginxNode) => (n.args[0]?.value ?? '').toUpperCase();

const SEC_HEADERS = new Set([
  'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy',
  'content-security-policy', 'content-security-policy-report-only', 'cross-origin-opener-policy', 'cross-origin-resource-policy', 'cross-origin-embedder-policy',
]);

const WEAK_CIPHER_RE = /(?:^|[-+:@])(?:RC4|3?DES|MD5|EXP(?:ORT)?\d*|NULL|aNULL|eNULL|LOW|ADH|SEED|IDEA)(?:[-+:]|$)/i;

function blockLabel(n: NginxNode): string {
  return `${n.name}${n.args.length ? ' ' + n.args.map((a) => a.value).join(' ') : ''}`;
}

/** Sinh chuỗi ví dụ từ regex đơn giản để so khớp thứ tự location regex */
function sampleFromRegex(p: string): string | null {
  if (p.length > 120) return null;
  let s = p.replace(/^\^/, '').replace(/\$$/, '');
  // (?:a|b) hoặc (a|b) -> lấy phương án đầu
  for (let k = 0; k < 8; k++) {
    const next = s.replace(/\((?:\?:|\?i\))?([^()|]*)(?:\|[^()]*)?\)/g, '$1');
    if (next === s) break;
    s = next;
  }
  s = s
    .replace(/\[\^[^\]]*\][+*]?/g, 'x')
    .replace(/\[([^\]^])[^\]]*\][+*?]?/g, '$1')
    .replace(/\\d[+*]?/g, '1')
    .replace(/\\w[+*]?/g, 'a')
    .replace(/\.[+*]/g, 'x')
    .replace(/\\\./g, '.')
    .replace(/\\\//g, '/')
    .replace(/\\-/g, '-')
    .replace(/[?*+]/g, '');
  if (/[\\()[\]{}|^$]/.test(s)) return null;
  if (!s.startsWith('/')) s = '/x' + (s.startsWith('.') ? '' : '/') + s;
  return s;
}

function safeRegex(pat: string, ci: boolean): RegExp | null {
  if (pat.length > 300) return null;
  try {
    return new RegExp(pat, ci ? 'i' : '');
  } catch {
    return null;
  }
}

export interface LintResult {
  issues: Issue[];
  root: NginxNode;
  lineCount: number;
  stats: { directives: number; blocks: number; servers: number; locations: number };
}

export function lintNginx(input: string): LintResult {
  const parsed = parseNginx(input);
  const issues: Issue[] = [...parsed.issues];
  const root = parsed.root;
  const stats = { directives: 0, blocks: 0, servers: 0, locations: 0 };
  try {
    lintTree(root, issues, stats);
  } catch (e) {
    pushIssue(issues, 'internal', 'warn', 1, 1, 'Lint gặp lỗi nội bộ: ' + (e instanceof Error ? e.message : String(e)));
  }
  issues.sort((a, b) => a.line - b.line || a.col - b.col);
  return { issues, root, lineCount: parsed.lineCount, stats };
}

function lintTree(root: NginxNode, issues: Issue[], stats: LintResult['stats']) {
  const top = root.children ?? [];
  const names = new Set(top.map((n) => n.name));
  let rootCtx: Ctx = 'any';
  if (names.has('http') || names.has('events') || names.has('worker_processes') || names.has('user') || names.has('stream')) rootCtx = 'main';
  else if (['server', 'upstream', 'map', 'geo', 'limit_req_zone', 'limit_conn_zone', 'log_format', 'proxy_cache_path'].some((x) => names.has(x))) rootCtx = 'http';

  // --- tiền xử lý toàn cục ---
  const upstreams = new Set<string>();
  const upstreamKeepalive = new Set<string>();
  const reqZones = new Set<string>();
  const connZones = new Set<string>();
  const cacheZones = new Set<string>();
  let hasInclude = false;
  let hasServerTokensOff = false;
  let hasBodySize = false;
  let hasUpstreamPass = false;
  const visitAll = (nodes: NginxNode[]) => {
    for (const n of nodes) {
      if (n.opaque) continue;
      if (n.name === 'include') hasInclude = true;
      if (n.name === 'upstream' && n.children) {
        const nm = n.args[0]?.value;
        if (nm) {
          upstreams.add(nm);
          if (n.children.some((c) => c.name === 'keepalive')) upstreamKeepalive.add(nm);
        }
      }
      const zoneArg = (n.args.find((a) => a.value.startsWith('zone=') || a.value.startsWith('keys_zone='))?.value ?? '').split('=')[1]?.split(':')[0];
      if (n.name === 'limit_req_zone' && zoneArg) reqZones.add(zoneArg);
      if (n.name === 'limit_conn_zone' && zoneArg) connZones.add(zoneArg);
      if (n.name === 'proxy_cache_path' && zoneArg) cacheZones.add(zoneArg);
      if (n.name === 'fastcgi_cache_path' && zoneArg) cacheZones.add(zoneArg);
      if (n.name === 'server_tokens' && n.args[0]?.value === 'off') hasServerTokensOff = true;
      if (n.name === 'client_max_body_size') hasBodySize = true;
      if (n.name === 'proxy_pass' || n.name === 'fastcgi_pass' || n.name === 'uwsgi_pass') hasUpstreamPass = true;
      if (n.children) visitAll(n.children);
    }
  };
  visitAll(top);

  const servers: ServerRec[] = [];

  const checkContext = (n: NginxNode, ctx: Ctx, info: DirectiveInfo) => {
    if (ctx === 'any' || info.contexts.includes('*')) return;
    let allowed = info.contexts;
    if (n.name === 'server') allowed = n.children ? ['http'] : ['upstream'];
    if (!allowed.includes(ctx)) {
      pushIssue(
        issues,
        'wrong-context',
        'error',
        n.line,
        n.col,
        `Directive "${n.name}" không được phép trong ngữ cảnh "${ctx}" (chỉ dùng trong: ${allowed.join(', ')}).`,
        `nginx sẽ báo lỗi "${n.name}" directive is not allowed here. Cú pháp: ${info.syntax}`
      );
    }
  };

  const nearestLocation = (n: NginxNode): { loc?: NginxNode; viaIf: boolean; viaLimitExcept: boolean } => {
    let viaIf = false;
    let viaLimitExcept = false;
    for (let p = n.parent; p; p = p.parent) {
      if (p.name === 'if') viaIf = true;
      else if (p.name === 'limit_except') viaLimitExcept = true;
      else if (p.name === 'location') return { loc: p, viaIf, viaLimitExcept };
    }
    return { viaIf, viaLimitExcept };
  };

  const enclosingServer = (n: NginxNode): NginxNode | undefined => {
    for (let p: NginxNode | undefined = n.parent; p; p = p.parent) if (p.name === 'server' && p.children) return p;
    return undefined;
  };

  const lintDirective = (n: NginxNode, ctx: Ctx) => {
    const a = vals(n);
    switch (n.name) {
      case 'proxy_pass': {
        const raw = a[0];
        if (!raw) {
          pushIssue(issues, 'syntax', 'error', n.line, n.col, 'proxy_pass thiếu tham số URL.');
          break;
        }
        const m = /^(https?):\/\/([^/]*)(\/.*)?$/.exec(raw);
        let uri: string | null = null;
        let host = '';
        if (!m) {
          if (hasVar(raw) && !/^https?:\/\//.test(raw)) break;
          pushIssue(issues, 'proxy-pass-uri', 'error', n.line, n.col, `proxy_pass "${raw}" phải bắt đầu bằng http:// hoặc https:// (hoặc tên upstream kèm scheme).`, 'Ví dụ: proxy_pass http://127.0.0.1:3000; hoặc proxy_pass http://backend;');
          break;
        }
        host = m[2];
        if (host.startsWith('unix:')) {
          // http://unix:/path/to.sock:/uri
          const rest = raw.slice('http://unix:'.length);
          const idx = rest.indexOf(':', 1);
          uri = idx >= 0 ? rest.slice(idx + 1) : null;
        } else uri = m[3] ?? null;
        const { loc, viaIf, viaLimitExcept } = nearestLocation(n);
        if (uri !== null && !hasVar(raw)) {
          const li = loc ? locationInfo(loc) : null;
          if (li && (li.mod === '~' || li.mod === '~*')) {
            pushIssue(issues, 'proxy-pass-uri', 'error', n.line, n.col, `proxy_pass có phần URI ("${uri}") trong location regex (${li.mod}) — nginx sẽ từ chối cấu hình này.`, 'Bỏ phần URI (chỉ giữ http://host:port), hoặc dùng rewrite + proxy_pass không URI, hoặc đổi sang location tiền tố.');
          } else if (li && li.named) {
            pushIssue(issues, 'proxy-pass-uri', 'error', n.line, n.col, 'proxy_pass có phần URI trong named location (@...) — nginx không cho phép.', 'Bỏ phần URI.');
          } else if (viaIf) {
            pushIssue(issues, 'proxy-pass-uri', 'error', n.line, n.col, 'proxy_pass có phần URI bên trong khối "if" — nginx không cho phép.', 'Bỏ phần URI hoặc chuyển ra ngoài if.');
          } else if (viaLimitExcept) {
            pushIssue(issues, 'proxy-pass-uri', 'error', n.line, n.col, 'proxy_pass có phần URI bên trong limit_except — nginx không cho phép.');
          } else if (li && li.mod !== '=') {
            const P = li.path;
            if (P.endsWith('/') && !uri.endsWith('/') && uri !== '') {
              pushIssue(issues, 'proxy-pass-uri', 'warn', n.line, n.col, `location "${P}" kết thúc bằng "/" nhưng proxy_pass URI "${uri}" thì không → "${P}abc" sẽ thành "${uri}abc" (thiếu dấu "/").`, `Hãy thêm "/" ở cuối: proxy_pass ${raw}/;`);
            } else if (!P.endsWith('/') && P !== '' && uri.endsWith('/')) {
              pushIssue(issues, 'proxy-pass-uri', 'warn', n.line, n.col, `location "${P}" không có "/" cuối nhưng proxy_pass kết thúc bằng "/" → "${P}/abc" sẽ thành "${uri}/abc" (có thể thừa dấu "//") và "${P}xyz" cũng khớp.`, `Đặt location "${P}/" hoặc bỏ "/" cuối trong proxy_pass. Nguyên tắc: hai bên cùng có hoặc cùng không có "/".`);
            }
          }
        } else if (uri === null && !hasVar(raw) && loc) {
          const li = locationInfo(loc);
          if ((li.mod === '' || li.mod === '^~') && li.path !== '/' && li.path !== '') {
            pushIssue(issues, 'proxy-pass-uri', 'info', n.line, n.col, `proxy_pass không có phần URI → backend nhận nguyên đường dẫn gốc (kể cả tiền tố "${li.path}").`, 'Muốn bỏ tiền tố: thêm "/" cuối proxy_pass (location và proxy_pass cùng kết thúc bằng "/").');
          }
        }
        // upstream chưa khai báo
        const h = stripPort(host);
        if (!host.startsWith('unix:') && !hasVar(host) && /^[A-Za-z0-9_-]+$/.test(h) && h !== 'localhost' && host === h && !upstreams.has(h) && !hasInclude) {
          pushIssue(issues, 'upstream-undefined', 'warn', n.line, n.col, `"${h}" không phải upstream đã khai báo; nginx sẽ coi là hostname và phân giải DNS lúc khởi động.`, `Khai báo upstream ${h} { server ...; } hoặc dùng host:port đầy đủ.`);
        }
        // header proxy
        const hdrs = effectiveSet(n.parent, 'proxy_set_header', keyLower);
        if (!hdrs || !hdrs.keys.has('host')) {
          pushIssue(issues, 'proxy-host-header', 'info', n.line, n.col, 'Chưa có "proxy_set_header Host $host;" ở phạm vi này → backend nhận Host = giá trị trong proxy_pass ($proxy_host), không phải tên miền client gọi.', 'Thêm proxy_set_header Host $host; (hoặc $http_host nếu cần giữ cổng).');
        }
        if (!hdrs || (!hdrs.keys.has('x-forwarded-for') && !hdrs.keys.has('x-real-ip'))) {
          pushIssue(issues, 'proxy-forwarded', 'info', n.line, n.col, 'Chưa truyền IP thật của client (X-Forwarded-For / X-Real-IP) tới backend.', 'Thêm proxy_set_header X-Real-IP $remote_addr; và proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
        }
        const ver = lookup(n.parent, 'proxy_http_version')?.args[0]?.value;
        if (hdrs && hdrs.keys.has('upgrade') && ver !== '1.1') {
          pushIssue(issues, 'websocket-http11', 'warn', n.line, n.col, 'Có truyền header Upgrade (WebSocket) nhưng chưa đặt "proxy_http_version 1.1;" → WebSocket sẽ không hoạt động.', 'Thêm proxy_http_version 1.1;');
        }
        const up = /^https?:\/\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(raw)?.[1];
        if (up && upstreamKeepalive.has(up)) {
          if (ver !== '1.1') pushIssue(issues, 'keepalive-http11', 'warn', n.line, n.col, `upstream "${up}" có keepalive nhưng thiếu "proxy_http_version 1.1;" → keepalive tới backend không hoạt động.`, 'Thêm proxy_http_version 1.1; và proxy_set_header Connection "";');
          else if (!hdrs || !hdrs.keys.has('connection')) pushIssue(issues, 'keepalive-connection', 'warn', n.line, n.col, `upstream "${up}" có keepalive nhưng chưa xóa header Connection → nginx gửi "Connection: close" làm mất tác dụng keepalive.`, 'Thêm proxy_set_header Connection ""; (hoặc map $http_upgrade nếu dùng WebSocket).');
        }
        break;
      }
      case 'alias': {
        const { loc } = nearestLocation(n);
        if (!loc || !a[0] || hasVar(a[0])) break;
        const li = locationInfo(loc);
        if (li.mod === '~' || li.mod === '~*' || li.named) break;
        const P = li.path;
        if (P.endsWith('/') && !a[0].endsWith('/')) {
          pushIssue(issues, 'alias-slash', 'warn', n.line, n.col, `location "${P}" kết thúc bằng "/" nhưng alias "${a[0]}" thì không → "${P}file" sẽ ghép thành "${a[0]}file" (thiếu "/").`, `Dùng alias ${a[0]}/;`);
        } else if (!P.endsWith('/') && P !== '' && a[0].endsWith('/')) {
          pushIssue(issues, 'alias-slash', 'warn', n.line, n.col, `location "${P}" không kết thúc bằng "/" nhưng alias "${a[0]}" thì có → "${P}xyz" cũng khớp và bị ghép sai.`, `Dùng location ${P}/ { alias ${a[0]}; }`);
        }
        break;
      }
      case 'root': {
        const p = n.parent;
        if (p && p.name === 'location') {
          const li = locationInfo(p);
          if (li.mod !== '=' && !li.named && !li.path.startsWith('/.well-known')) {
            pushIssue(issues, 'root-in-location', 'info', n.line, n.col, '"root" đặt trong location: dễ lặp lại và khó bảo trì.', 'Ưu tiên đặt root ở cấp server { } để mọi location kế thừa; chỉ ghi đè khi thực sự cần.');
          }
        }
        break;
      }
      case 'try_files': {
        if (a.length < 2) {
          pushIssue(issues, 'try-files', 'error', n.line, n.col, 'try_files cần ít nhất 2 tham số (các file thử + fallback cuối).', 'Ví dụ: try_files $uri $uri/ =404;');
          break;
        }
        const last = a[a.length - 1];
        if (!(last.startsWith('=') || last.startsWith('@') || last.startsWith('/'))) {
          pushIssue(issues, 'try-files', 'warn', n.line, n.col, `Tham số cuối của try_files ("${last}") là URI chuyển hướng nội bộ nhưng không bắt đầu bằng "/", "=" hoặc "@".`, 'Tham số cuối không phải là file để thử mà là fallback: dùng /index.html, =404 hoặc @named.');
        } else if (last === '$uri' || last === '$uri/') {
          pushIssue(issues, 'try-files', 'warn', n.line, n.col, `Tham số cuối của try_files là "${last}" → fallback chuyển hướng nội bộ về chính URI và có thể gây vòng lặp/lỗi 500.`, 'Thay bằng =404 hoặc /index.html.');
        }
        break;
      }
      case 'if': {
        const first = n.args[0]?.value ?? '';
        const lastA = n.args[n.args.length - 1]?.value ?? '';
        if (n.args.length === 0 || !first.startsWith('(') || !lastA.endsWith(')')) {
          pushIssue(issues, 'if-syntax', 'error', n.line, n.col, 'Điều kiện của "if" phải nằm trong dấu ngoặc đơn: if ($biến = giá_trị) { ... }.', 'Ví dụ: if ($request_method = POST) { return 405; }');
        }
        const { loc } = nearestLocation(n);
        if (loc && n.children) {
          const bad = n.children.filter((c) => !['return', 'rewrite', 'set', 'break', 'add_header', 'error_page'].includes(c.name) && !c.opaque);
          const hasReturn = n.children.some((c) => c.name === 'return');
          const onlyHeaders = n.children.some((c) => c.name === 'add_header') && !hasReturn;
          if (bad.length || onlyHeaders || n.children.some((c) => c.name === 'error_page')) {
            const names = Array.from(new Set([...bad.map((c) => c.name), ...(onlyHeaders ? ['add_header (không có return)'] : []), ...n.children.filter((c) => c.name === 'error_page').map((c) => c.name)]));
            pushIssue(
              issues,
              'if-evil',
              'warn',
              n.line,
              n.col,
              `"if" trong location chứa directive không an toàn (${names.join(', ')}) — "if is evil": if tạo location ngầm, directive bên trong có thể bị bỏ qua hoặc cho kết quả bất ngờ.`,
              'Chỉ nên dùng return / rewrite ... last / set bên trong if. Thay thế bằng map, try_files hoặc location riêng.'
            );
          }
        }
        break;
      }
      case 'return': {
        const code = a[0];
        if (code && /^3\d\d$/.test(code) && a[1]) {
          const t = a[1];
          const srv = enclosingServer(n);
          const rec = srv ? servers.find((s) => s.node === srv) : undefined;
          const insideIf = (() => {
            for (let p = n.parent; p; p = p.parent) if (p.name === 'if') return true;
            return false;
          })();
          if (rec && !insideIf) {
            const hasSsl = rec.listens.some((l) => l.opts.has('ssl') || l.opts.has('quic'));
            const hasPlain = rec.listens.some((l) => !l.opts.has('ssl') && !l.opts.has('quic'));
            const tHost = /^https?:\/\/(\$\w+|[^/$]+)/.exec(t)?.[1];
            const sameHost = tHost !== undefined && (tHost === '$host' || tHost === '$http_host' || rec.names.includes(tHost));
            if (t.startsWith('http://') && !hasSsl && sameHost) {
              pushIssue(issues, 'redirect-loop', 'warn', n.line, n.col, `Server chỉ lắng nghe HTTP (không ssl) nhưng redirect ${code} về "${t}" cùng host qua http:// → vòng lặp redirect vô hạn (ERR_TOO_MANY_REDIRECTS).`, 'HTTP → HTTPS phải redirect sang https:// trong server lắng nghe cổng 80; không redirect http:// về chính nó.');
            } else if (t.startsWith('https://') && hasSsl && !hasPlain && sameHost) {
              pushIssue(issues, 'redirect-loop', 'warn', n.line, n.col, `Server chỉ lắng nghe HTTPS nhưng redirect ${code} về "${t}" cùng host qua https:// → vòng lặp redirect.`, 'Đặt redirect HTTP→HTTPS trong server riêng lắng nghe cổng 80.');
            }
          }
          const m2 = /^https?:\/\/[^/]*\/?$/.exec(t);
          if (m2 && !/\$(?:request_uri|uri|1|is_args)/.test(t)) {
            pushIssue(issues, 'redirect-path', 'info', n.line, n.col, `Redirect "${t}" không giữ đường dẫn/query: mọi URL cũ đều về trang chủ.`, 'Thêm $request_uri để giữ nguyên path + query: return 301 ' + t.replace(/\/$/, '') + '$request_uri;');
          }
        }
        break;
      }
      case 'ssl_protocols': {
        const old = a.filter((x) => /^(SSLv2|SSLv3|TLSv1|TLSv1\.1)$/i.test(x));
        if (old.length) {
          pushIssue(issues, 'ssl-protocols', 'warn', n.line, n.col, `ssl_protocols còn bật giao thức lỗi thời: ${old.join(', ')}.`, 'Chỉ nên dùng: ssl_protocols TLSv1.2 TLSv1.3; (Mozilla intermediate).');
        }
        break;
      }
      case 'ssl_ciphers': {
        const raw = a[0] ?? '';
        if (hasVar(raw)) break;
        const weak = raw.split(':').filter((t) => t && !t.startsWith('!') && !t.startsWith('-') && WEAK_CIPHER_RE.test(t));
        if (weak.length) {
          pushIssue(issues, 'ssl-ciphers', 'warn', n.line, n.col, `ssl_ciphers chứa cipher yếu/lỗi thời: ${weak.slice(0, 6).join(', ')}.`, 'Dùng danh sách Mozilla intermediate (ECDHE-*-AES*-GCM, CHACHA20-POLY1305) hoặc thêm !aNULL:!MD5:!RC4.');
        }
        break;
      }
      case 'server_tokens': {
        if (a[0] === 'on' || a[0] === 'build') {
          pushIssue(issues, 'server-tokens', 'warn', n.line, n.col, 'server_tokens bật → lộ phiên bản nginx trong header Server và trang lỗi.', 'Đặt server_tokens off;');
        }
        break;
      }
      case 'autoindex': {
        if (a[0] === 'on') pushIssue(issues, 'autoindex', 'warn', n.line, n.col, 'autoindex on liệt kê nội dung thư mục → có thể lộ file nhạy cảm (backup, .env, mã nguồn).', 'Chỉ bật cho thư mục tải xuống công khai và có chủ đích; mặc định nên off.');
        break;
      }
      case 'client_max_body_size': {
        if (a[0] === '0') pushIssue(issues, 'body-size', 'info', n.line, n.col, 'client_max_body_size 0 = không giới hạn kích thước upload, dễ bị lạm dụng chiếm đĩa/băng thông.', 'Đặt giới hạn hợp lý, ví dụ 50m.');
        break;
      }
      case 'add_header': {
        const nm = (a[0] ?? '').toLowerCase();
        if (SEC_HEADERS.has(nm) && a[2] !== 'always') {
          pushIssue(issues, 'add-header-always', 'info', n.line, n.col, `add_header ${a[0]} thiếu tham số "always" → header không được gửi kèm phản hồi lỗi (4xx/5xx).`, `Viết: add_header ${a[0]} ${a[1] ? '"' + a[1] + '"' : '...'} always;`);
        }
        if (nm === 'access-control-allow-origin' && a[1] === '*') {
          const sib = n.parent?.children?.some((c) => c.name === 'add_header' && (c.args[0]?.value ?? '').toLowerCase() === 'access-control-allow-credentials' && c.args[1]?.value === 'true');
          if (sib) pushIssue(issues, 'cors-wildcard', 'error', n.line, n.col, 'Access-Control-Allow-Origin: * kết hợp Allow-Credentials: true bị trình duyệt từ chối (và nguy hiểm).', 'Dùng map $http_origin để phản chiếu origin được phép thay vì "*".');
        }
        break;
      }
      case 'limit_req': {
        const z = a.find((x) => x.startsWith('zone='))?.slice(5);
        if (z && !reqZones.has(z) && !hasInclude) pushIssue(issues, 'zone-undefined', 'error', n.line, n.col, `limit_req dùng zone "${z}" nhưng chưa có limit_req_zone tương ứng.`, 'Khai báo limit_req_zone $binary_remote_addr zone=' + z + ':10m rate=10r/s; trong http { }.');
        break;
      }
      case 'limit_conn': {
        const z = a[0];
        if (z && !hasVar(z) && !connZones.has(z) && !hasInclude) pushIssue(issues, 'zone-undefined', 'error', n.line, n.col, `limit_conn dùng zone "${z}" nhưng chưa có limit_conn_zone tương ứng.`, 'Khai báo limit_conn_zone $binary_remote_addr zone=' + z + ':10m; trong http { }.');
        break;
      }
      case 'proxy_cache': {
        const z = a[0];
        if (z && z !== 'off' && !hasVar(z) && !cacheZones.has(z) && !hasInclude) pushIssue(issues, 'zone-undefined', 'error', n.line, n.col, `proxy_cache dùng zone "${z}" nhưng chưa có proxy_cache_path keys_zone=${z}:...`, 'Khai báo proxy_cache_path trong http { }.');
        break;
      }
      case 'fastcgi_pass': {
        break;
      }
      default:
        break;
    }
  };

  const walk = (nodes: NginxNode[], ctx: Ctx) => {
    for (const n of nodes) {
      if (n.opaque) continue;
      const isBlock = n.children !== undefined;
      if (isBlock) stats.blocks++;
      else stats.directives++;
      const info = getDirectiveInfo(n.name);
      if (!info) {
        if (DEPRECATED[n.name]) {
          pushIssue(issues, 'deprecated', 'error', n.line, n.col, DEPRECATED[n.name]);
        } else if (n.name === '(block)') {
          // đã báo ở parser
        } else {
          const sug = suggestDirective(n.name);
          const prefix = n.name.split('_')[0];
          if (sug) {
            pushIssue(issues, 'unknown-directive', 'error', n.line, n.col, `Directive "${n.name}" không tồn tại — có phải ý bạn là "${sug}"?`, `${sug}: ${DICT[sug].desc}`);
          } else if (MODULE_PREFIXES.includes(prefix)) {
            pushIssue(issues, 'unknown-directive', 'info', n.line, n.col, `Directive "${n.name}" không có trong từ điển (có thể thuộc module tuỳ chọn/bên thứ ba hoặc nginx Plus).`, 'Hãy chắc chắn module tương ứng đã được cài/nạp.');
          } else {
            pushIssue(issues, 'unknown-directive', 'warn', n.line, n.col, `Không nhận ra directive "${n.name}".`, 'Kiểm tra lại chính tả; nếu là module bên thứ ba thì có thể bỏ qua cảnh báo này.');
          }
        }
        if (isBlock) continue;
        continue;
      }
      checkContext(n, ctx, info);

      if (isBlock) {
        let childCtx: Ctx | null = null;
        switch (n.name) {
          case 'events': childCtx = 'events'; break;
          case 'http': childCtx = 'http'; break;
          case 'server': childCtx = 'server'; stats.servers++; break;
          case 'location': childCtx = 'location'; stats.locations++; break;
          case 'upstream': childCtx = 'upstream'; break;
          case 'if': childCtx = ctx; lintDirective(n, ctx); break;
          case 'limit_except': childCtx = 'location'; break;
          default: childCtx = null;
        }
        if (n.name === 'location') {
          if (n.args.length < 1 || n.args.length > 2) {
            pushIssue(issues, 'location-args', 'error', n.line, n.col, 'location cần 1 hoặc 2 tham số: location [= | ~ | ~* | ^~] uri { ... }.');
          } else if (n.args.length === 2 && !LOC_MODS.has(n.args[0].value)) {
            pushIssue(issues, 'location-args', 'error', n.line, n.col, `Modifier "${n.args[0].value}" của location không hợp lệ (chỉ có =, ~, ~*, ^~).`);
          }
        }
        if (n.name === 'server') {
          const rec: ServerRec = { node: n, listens: [], names: [] };
          for (const c of n.children ?? []) {
            if (c.name === 'listen') {
              const li = parseListen(c);
              if (li) rec.listens.push(li);
            } else if (c.name === 'server_name') rec.names.push(...vals(c));
          }
          servers.push(rec);
        }
        // kế thừa add_header / proxy_set_header / fastcgi_param
        if (['server', 'location', 'if', 'limit_except'].includes(n.name) && n.children) {
          const checks: [string, (x: NginxNode) => string, Severity][] = [
            ['add_header', keyLower, 'warn'],
            ['proxy_set_header', keyLower, 'warn'],
            ['fastcgi_param', keyUpper, 'info'],
          ];
          for (const [dn, kf, sev] of checks) {
            const own = n.children.filter((c) => c.name === dn && !c.children);
            if (!own.length) continue;
            const ownKeys = new Set(own.map(kf));
            const inherited = effectiveSet(n.parent, dn, kf);
            if (!inherited) continue;
            const missing = Array.from(inherited.keys).filter((k) => k && !ownKeys.has(k));
            if (missing.length) {
              pushIssue(
                issues,
                dn === 'add_header' ? 'add-header-inherit' : 'directive-inherit',
                sev,
                own[0].line,
                own[0].col,
                `"${blockLabel(n)}" có ${dn} riêng nên KHÔNG kế thừa ${dn} của cấp trên (${inherited.owner.name === '(root)' ? 'http' : inherited.owner.name}): đang mất ${missing.length} mục — ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}.`,
                `nginx chỉ kế thừa ${dn} khi cấp hiện tại không khai báo cái nào. Hãy lặp lại các dòng ${dn} cần thiết ở đây (hoặc gom vào file snippet và include).`
              );
            }
          }
        }
        if (childCtx !== null && n.children) walk(n.children, childCtx);
        if (n.name === 'server') {
          const rec = servers.find((s) => s.node === n);
          if (rec) checkServer(rec);
        }
      } else {
        // directive thường
        if (n.name === 'listen' && n.parent?.name === 'server') {
          const li = parseListen(n);
          if (li && li.opts.has('http2')) {
            pushIssue(issues, 'http2-deprecated', 'info', n.line, n.col, 'Tham số "http2" của listen đã lỗi thời từ nginx 1.25.1.', 'Dùng: listen 443 ssl; + http2 on; (bản nginx cũ hơn 1.25.1 thì giữ nguyên).');
          }
        }
        lintDirective(n, ctx);
      }
    }
  };

  const checkServer = (rec: ServerRec) => {
    const n = rec.node;
    const kids = n.children ?? [];
    const sslListen = rec.listens.find((l) => l.opts.has('ssl') || l.opts.has('quic'));
    if (sslListen) {
      const rejects = lookup(n, 'ssl_reject_handshake')?.args[0]?.value === 'on';
      if (!rejects) {
        if (!lookup(n, 'ssl_certificate')) pushIssue(issues, 'ssl-cert-missing', 'error', sslListen.node.line, sslListen.node.col, 'Server lắng nghe với "ssl" nhưng không có ssl_certificate (kể cả ở cấp http).', 'Thêm ssl_certificate /đường/dẫn/fullchain.pem; và ssl_certificate_key /đường/dẫn/privkey.pem;');
        else if (!lookup(n, 'ssl_certificate_key')) pushIssue(issues, 'ssl-cert-missing', 'error', sslListen.node.line, sslListen.node.col, 'Có ssl_certificate nhưng thiếu ssl_certificate_key.', 'Thêm ssl_certificate_key /đường/dẫn/privkey.pem;');
      }
      if (!lookup(n, 'ssl_prefer_server_ciphers')) {
        pushIssue(issues, 'ssl-prefer-server-ciphers', 'info', sslListen.node.line, sslListen.node.col, 'Chưa đặt ssl_prefer_server_ciphers tường minh.', 'Mozilla intermediate khuyến nghị: ssl_prefer_server_ciphers off; (để client chọn cipher tốt nhất cho thiết bị).');
      }
      if (!lookup(n, 'ssl_protocols')) {
        pushIssue(issues, 'ssl-protocols-default', 'info', sslListen.node.line, sslListen.node.col, 'Chưa đặt ssl_protocols; giá trị mặc định phụ thuộc phiên bản nginx (bản cũ còn bật TLSv1/1.1).', 'Đặt ssl_protocols TLSv1.2 TLSv1.3;');
      }
    } else if (lookup(n, 'ssl_certificate') && rec.listens.length) {
      const c = lookup(n, 'ssl_certificate')!;
      if (c.parent === n) pushIssue(issues, 'ssl-no-listen', 'info', c.line, c.col, 'Có ssl_certificate nhưng không có listen nào kèm "ssl" → server này vẫn phục vụ HTTP thường.', 'Dùng listen 443 ssl;');
    }
    // server_name _
    if (rec.names.includes('_') && !rec.listens.some((l) => l.opts.has('default_server'))) {
      const sn = kids.find((c) => c.name === 'server_name');
      if (sn) pushIssue(issues, 'server-name-underscore', 'info', sn.line, sn.col, 'server_name _ chỉ là tên giả không khớp host nào; nó KHÔNG tự thành server mặc định.', 'Muốn làm server bắt mọi host lạ, thêm default_server vào listen (vd: listen 80 default_server;).');
    }
    // location trùng + thứ tự regex
    const locs = kids.filter((c) => c.name === 'location' && c.children);
    const seen = new Map<string, NginxNode>();
    const regexLocs: { n: NginxNode; li: LocationInfo; re: RegExp | null }[] = [];
    for (const l of locs) {
      const li = locationInfo(l);
      const key = `${li.mod}|${li.mod === '~*' ? li.path.toLowerCase() : li.path}`;
      const prev = seen.get(key);
      if (prev) pushIssue(issues, 'location-dup', 'error', l.line, l.col, `Location "${blockLabel(l)}" bị khai báo trùng (đã có ở dòng ${prev.line}) → nginx báo "duplicate location".`, 'Gộp hai khối làm một.');
      else seen.set(key, l);
      if (li.mod === '~' || li.mod === '~*') regexLocs.push({ n: l, li, re: safeRegex(li.path, li.mod === '~*') });
    }
    for (let j = 1; j < regexLocs.length; j++) {
      const later = regexLocs[j];
      const sample = sampleFromRegex(later.li.path);
      if (!sample || !later.re || !later.re.test(sample)) continue;
      for (let k = 0; k < j; k++) {
        const earlier = regexLocs[k];
        if (earlier.re && earlier.re.test(sample)) {
          pushIssue(issues, 'regex-order', 'warn', later.n.line, later.n.col, `Location regex "${later.li.path}" có thể không bao giờ được dùng: location regex ở dòng ${earlier.n.line} ("${earlier.li.path}") đứng trước và cũng khớp (ví dụ URI "${sample}").`, 'Location regex được thử THEO THỨ TỰ XUẤT HIỆN, khớp đầu tiên thắng. Đặt regex cụ thể lên trước, regex rộng ra sau (hoặc dùng ^~ cho tiền tố).');
          break;
        }
      }
    }
  };

  walk(top, rootCtx);

  // --- kiểm tra toàn cục giữa các server ---
  const byKey = new Map<string, { rec: ServerRec; l: ListenInfo }[]>();
  for (const rec of servers) for (const l of rec.listens) {
    const arr = byKey.get(l.key) ?? [];
    arr.push({ rec, l });
    byKey.set(l.key, arr);
  }
  const SOCKET_OPTS = ['reuseport', 'backlog', 'rcvbuf', 'sndbuf', 'so_keepalive', 'bind', 'ipv6only', 'fastopen', 'deferred', 'setfib', 'accept_filter'];
  byKey.forEach((arr, key) => {
    if (arr.length < 2) return;
    const defs = arr.filter((x) => x.l.opts.has('default_server'));
    if (defs.length > 1) {
      for (const d of defs.slice(1)) pushIssue(issues, 'default-server-dup', 'error', d.l.node.line, d.l.node.col, `Có nhiều hơn một default_server cho ${key} (đã có ở dòng ${defs[0].l.node.line}) → nginx báo "a duplicate default server".`, 'Mỗi cặp địa chỉ:cổng chỉ được một default_server.');
    }
    for (const o of SOCKET_OPTS) {
      const withO = arr.filter((x) => x.l.opts.has(o));
      if (withO.length > 1) {
        for (const d of withO.slice(1)) pushIssue(issues, 'listen-options', 'error', d.l.node.line, d.l.node.col, `Tuỳ chọn "${o}" của listen ${key} khai báo lặp ở nhiều server (đã có ở dòng ${withO[0].l.node.line}) → nginx báo "duplicate listen options".`, 'Các tuỳ chọn socket (reuseport, backlog, so_keepalive...) chỉ khai báo một lần cho mỗi địa chỉ:cổng.');
      }
    }
    const ssls = arr.map((x) => x.l.opts.has('ssl'));
    if (ssls.some(Boolean) && !ssls.every(Boolean)) {
      const odd = arr.find((x) => !x.l.opts.has('ssl'))!;
      pushIssue(issues, 'listen-ssl-mismatch', 'warn', odd.l.node.line, odd.l.node.col, `Cùng ${key} nhưng có server khai báo "ssl", có server không → hành vi dễ gây nhầm lẫn (ssl áp dụng theo từng server, nhưng handshake theo socket).`, 'Dùng nhất quán: cổng 443 luôn kèm ssl; cổng 80 không kèm ssl.');
    }
    const seenName = new Map<string, ServerRec>();
    for (const x of arr) {
      for (const nm of x.rec.names) {
        const prev = seenName.get(nm);
        if (prev && prev !== x.rec) {
          const sn = x.rec.node.children?.find((c) => c.name === 'server_name');
          pushIssue(issues, 'server-name-dup', 'warn', sn?.line ?? x.rec.node.line, sn?.col ?? x.rec.node.col, `server_name "${nm}" bị trùng trên ${key} (server ở dòng ${prev.node.line}) → nginx cảnh báo "conflicting server name" và bỏ qua cái sau.`);
        } else seenName.set(nm, x.rec);
      }
    }
  });

  if (servers.length > 0 && !hasServerTokensOff && !issues.some((i) => i.rule === 'server-tokens')) {
    const s0 = servers[0].node;
    pushIssue(issues, 'server-tokens-missing', 'info', s0.line, s0.col, 'Chưa tắt server_tokens → phiên bản nginx hiển thị công khai trong header Server và trang lỗi.', 'Thêm server_tokens off; (trong http hoặc server).');
  }
  if (hasUpstreamPass && !hasBodySize) {
    const s0 = servers[0]?.node;
    if (s0) pushIssue(issues, 'body-size-missing', 'info', s0.line, s0.col, 'Chưa đặt client_max_body_size: mặc định chỉ 1m, upload lớn hơn sẽ nhận lỗi 413 Request Entity Too Large.', 'Nếu có upload file, đặt client_max_body_size 20m; (hoặc giá trị phù hợp).');
  }
}

/* ========================================================================== */
/* 3b. GIẢI THÍCH TỪNG DÒNG                                                   */
/* ========================================================================== */

export interface ExplainItem {
  line: number;
  depth: number;
  kind: 'directive' | 'block' | 'close' | 'comment' | 'entry';
  source: string;
  title: string;
  text: string;
  details: string[];
}

const LOC_MOD_EXPLAIN: Record<string, string> = {
  '=': 'Khớp CHÍNH XÁC URI (ưu tiên cao nhất, dừng ngay khi khớp).',
  '^~': 'Khớp tiền tố; nếu là tiền tố dài nhất thì BỎ QUA bước thử regex.',
  '~': 'Regex phân biệt hoa/thường; thử theo thứ tự xuất hiện, khớp đầu tiên thắng.',
  '~*': 'Regex KHÔNG phân biệt hoa/thường; thử theo thứ tự xuất hiện.',
  '': 'Khớp tiền tố (prefix); nginx nhớ tiền tố dài nhất rồi mới thử regex — nếu có regex khớp thì regex thắng.',
};

function explainNode(n: NginxNode): { title: string; text: string; details: string[] } {
  const a = vals(n);
  const info = getDirectiveInfo(n.name);
  const details: string[] = [];
  let text = info ? info.desc : 'Directive không có trong từ điển (module tuỳ chọn/bên thứ ba hoặc sai chính tả).';
  if (info) details.push(`Cú pháp: ${info.syntax}`, `Ngữ cảnh: ${info.contexts.join(', ') || '—'}`);
  switch (n.name) {
    case 'location': {
      const li = locationInfo(n);
      text = li.named ? `Named location ${li.path} — chỉ dùng nội bộ (error_page, try_files).` : `Khối xử lý URI ${li.mod ? 'với modifier "' + li.mod + '"' : '(tiền tố)'} "${li.path}". ${LOC_MOD_EXPLAIN[li.mod]}`;
      details.push('Thứ tự ưu tiên: 1) "=" khớp chính xác → 2) tiền tố dài nhất (nếu là ^~ thì dừng) → 3) regex (~, ~*) theo thứ tự trong file → 4) tiền tố dài nhất đã nhớ.');
      break;
    }
    case 'listen': {
      const li = parseListen(n);
      if (li) {
        const o: string[] = [];
        if (li.opts.has('ssl')) o.push('bật TLS');
        if (li.opts.has('quic')) o.push('QUIC/HTTP3 (UDP)');
        if (li.opts.has('http2')) o.push('HTTP/2 (cách cũ)');
        if (li.opts.has('default_server')) o.push('server mặc định cho cổng này');
        if (li.opts.has('reuseport')) o.push('reuseport (mỗi worker một socket)');
        text = `Lắng nghe ${li.key}${o.length ? ' — ' + o.join(', ') : ''}.`;
      }
      break;
    }
    case 'server_name':
      text = `Phục vụ các tên miền: ${a.join(', ')}.`;
      if (a.some((x) => x === '_')) details.push('"_" là tên giả không khớp host thật; thường dùng cùng default_server để bắt host lạ.');
      if (a.some((x) => x.startsWith('*.') || x.startsWith('.'))) details.push('Tên bắt đầu bằng "*." hoặc "." là wildcard (".x.com" khớp cả x.com và *.x.com).');
      if (a.some((x) => x.startsWith('~'))) details.push('Tên bắt đầu bằng "~" là regex.');
      details.push('Thứ tự khớp: tên chính xác → wildcard đầu dài nhất → wildcard cuối dài nhất → regex đầu tiên → default_server.');
      break;
    case 'return':
      if (/^30[1278]$/.test(a[0] ?? '')) text = `Chuyển hướng HTTP ${a[0]} ${a[0] === '301' || a[0] === '308' ? '(vĩnh viễn)' : '(tạm thời)'} tới ${a[1] ?? '?'}.`;
      else if (a[0]) text = `Trả về ngay mã ${a[0]}${a[1] ? ' kèm nội dung "' + a[1] + '"' : ''}.`;
      if (a[1] && a[1].includes('$request_uri')) details.push('$request_uri = đường dẫn gốc kèm query string, nên giữ nguyên URL khi redirect.');
      break;
    case 'proxy_pass': {
      const m = /^(https?):\/\/([^/]*)(\/.*)?$/.exec(a[0] ?? '');
      if (m) {
        text = `Chuyển tiếp request tới ${m[1].toUpperCase()} backend "${m[2]}".`;
        details.push(m[3] !== undefined
          ? `Có phần URI "${m[3]}": phần đường dẫn khớp với location được THAY bằng URI này (cẩn thận dấu "/" ở hai bên).`
          : 'Không có phần URI: giữ nguyên đường dẫn gốc của request gửi tới backend.');
      }
      break;
    }
    case 'try_files':
      if (a.length >= 2) text = `Thử lần lượt: ${a.slice(0, -1).join(' → ')}; nếu đều không tồn tại thì ${a[a.length - 1].startsWith('=') ? 'trả mã ' + a[a.length - 1].slice(1) : 'chuyển hướng nội bộ tới ' + a[a.length - 1]}.`;
      break;
    case 'root':
      text = `Thư mục gốc "${a[0] ?? ''}". URI /abc sẽ được ghép thành ${a[0] ?? ''}/abc.`;
      break;
    case 'alias':
      text = `Thay phần location khớp bằng "${a[0] ?? ''}" (khác root: không ghép tiền tố location vào).`;
      break;
    case 'add_header':
      text = `Thêm header phản hồi "${a[0] ?? ''}: ${a[1] ?? ''}"${a[2] === 'always' ? ' trong MỌI mã trạng thái' : ' (chỉ với mã 200, 201, 204, 206, 301, 302, 303, 304, 307, 308)'}.`;
      details.push('Lưu ý: nếu một cấp (server/location) có add_header riêng thì mất toàn bộ add_header kế thừa từ cấp trên.');
      break;
    case 'expires':
      text = `Đặt thời gian cache của trình duyệt: ${a.join(' ')}.`;
      break;
    case 'limit_req_zone': {
      const z = a.find((x) => x.startsWith('zone='));
      const r = a.find((x) => x.startsWith('rate='));
      text = `Tạo vùng đếm request theo khoá ${a[0] ?? ''}${z ? ', ' + z : ''}${r ? ', tốc độ ' + r.slice(5) : ''}.`;
      break;
    }
    case 'limit_req':
      text = `Áp dụng giới hạn tốc độ ${a.join(' ')}. burst = số request được xếp hàng vượt mức; nodelay = xử lý ngay thay vì làm chậm.`;
      break;
    case 'ssl_protocols':
      text = `Chỉ cho phép: ${a.join(', ')}.`;
      break;
    case 'gzip_types':
      text = `Nén gzip các MIME: ${a.join(', ')} (text/html luôn được nén).`;
      break;
    case 'proxy_set_header':
      text = `Gửi header "${a[0] ?? ''}" = ${a[1] === undefined ? '' : a[1] === '' ? '(rỗng → xoá header)' : a[1]} tới backend.`;
      details.push('Nếu cấp hiện tại có proxy_set_header riêng thì không kế thừa proxy_set_header cấp trên.');
      break;
    case 'if':
      text = `Điều kiện ${a.join(' ')}. Trong location chỉ nên chứa return/rewrite/set ("if is evil").`;
      break;
    case 'server':
      if (n.children) text = 'Khối virtual host: nhóm cấu hình cho một (hoặc vài) tên miền + cổng lắng nghe.';
      else text = `Máy chủ backend ${a[0] ?? ''}${a.length > 1 ? ' — ' + a.slice(1).join(' ') : ''}.`;
      break;
    case 'map':
      text = `Tạo biến ${a[1] ?? ''} từ ${a[0] ?? ''} theo bảng tra bên dưới (khớp chính xác, "default" là giá trị mặc định; "~" bắt đầu regex).`;
      break;
    case 'upstream':
      text = `Nhóm backend "${a[0] ?? ''}"; dùng bằng proxy_pass http://${a[0] ?? ''}.`;
      break;
    case 'include':
      text = `Chèn nội dung file/glob "${a[0] ?? ''}" tại vị trí này.`;
      break;
    default:
      break;
  }
  return { title: n.name, text, details };
}

export function explainConfig(input: string): ExplainItem[] {
  const out: ExplainItem[] = [];
  try {
    const src = input.replace(/\r\n?/g, '\n').slice(0, MAX_CONFIG_CHARS);
    const lines = src.split('\n');
    const parsed = parseNginx(src);
    const byLine = new Map<number, ExplainItem>();
    const walkE = (nodes: NginxNode[], depth: number) => {
      for (const n of nodes) {
        const src1 = (lines[n.line - 1] ?? '').trim();
        if (n.opaque) {
          if (!byLine.has(n.line)) byLine.set(n.line, { line: n.line, depth, kind: n.children ? 'block' : 'entry', source: src1, title: 'Mục trong bảng', text: `"${n.name}${n.args.length ? ' ' + n.args.map((x) => x.value).join(' ') : ''}" — mục của khối ${n.parent?.name ?? ''} (khoá → giá trị).`, details: [] });
        } else {
          const ex = explainNode(n);
          if (!byLine.has(n.line)) byLine.set(n.line, { line: n.line, depth, kind: n.children ? 'block' : 'directive', source: src1, title: ex.title, text: ex.text, details: ex.details });
        }
        if (n.children) {
          if (n.endLine > n.line) {
            const closeSrc = (lines[n.endLine - 1] ?? '').trim();
            if (closeSrc.startsWith('}') && !byLine.has(n.endLine)) byLine.set(n.endLine, { line: n.endLine, depth, kind: 'close', source: closeSrc, title: '}', text: `Kết thúc block "${n.name}" mở ở dòng ${n.line}.`, details: [] });
          }
          walkE(n.children, depth + 1);
        }
      }
    };
    walkE(parsed.root.children ?? [], 0);
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t.startsWith('#') && !byLine.has(i + 1)) byLine.set(i + 1, { line: i + 1, depth: 0, kind: 'comment', source: t, title: 'Chú thích', text: 'Dòng chú thích, nginx bỏ qua.', details: [] });
    }
    out.push(...Array.from(byLine.values()).sort((x, y) => x.line - y.line));
  } catch {
    /* bỏ qua */
  }
  return out;
}

/* ========================================================================== */
/* 3c. THỬ KHỚP LOCATION                                                      */
/* ========================================================================== */

export interface LocEntry {
  mod: string;
  path: string;
}

export interface LocMatch {
  index: number;
  steps: string[];
}

export function matchLocation(locs: LocEntry[], uriInput: string): LocMatch | null {
  const steps: string[] = [];
  let uri = uriInput.split('?')[0].split('#')[0];
  if (uri.length > 300) uri = uri.slice(0, 300);
  if (!uri.startsWith('/')) uri = '/' + uri;
  // 1) exact
  const ex = locs.findIndex((l) => l.mod === '=' && l.path === uri);
  if (ex >= 0) return { index: ex, steps: [`Bước 1: location = ${locs[ex].path} khớp chính xác URI → dùng ngay.`] };
  steps.push('Bước 1: không có location "=" khớp chính xác.');
  // 2) prefix dài nhất
  let best = -1;
  for (let i = 0; i < locs.length; i++) {
    const l = locs[i];
    if ((l.mod === '' || l.mod === '^~') && !l.path.startsWith('@') && uri.startsWith(l.path)) {
      if (best < 0 || l.path.length > locs[best].path.length) best = i;
    }
  }
  if (best >= 0) {
    steps.push(`Bước 2: tiền tố dài nhất khớp là "${locs[best].mod ? locs[best].mod + ' ' : ''}${locs[best].path}".`);
    if (locs[best].mod === '^~') {
      steps.push('Tiền tố này có ^~ nên nginx DỪNG, không thử regex.');
      return { index: best, steps };
    }
  } else steps.push('Bước 2: không có location tiền tố nào khớp.');
  // 3) regex theo thứ tự
  for (let i = 0; i < locs.length; i++) {
    const l = locs[i];
    if (l.mod !== '~' && l.mod !== '~*') continue;
    const re = safeRegex(l.path, l.mod === '~*');
    if (re && re.test(uri)) {
      steps.push(`Bước 3: regex đầu tiên khớp (theo thứ tự trong file) là "${l.mod} ${l.path}" → regex thắng tiền tố.`);
      return { index: i, steps };
    }
  }
  steps.push('Bước 3: không có regex nào khớp.');
  if (best >= 0) {
    steps.push('Bước 4: dùng tiền tố dài nhất đã nhớ ở bước 2.');
    return { index: best, steps };
  }
  return null;
}

/** Lấy danh sách location (không named) của server "chính" trong cấu hình đã sinh */
export function extractLocations(text: string): LocEntry[] {
  try {
    const { root } = parseNginx(text);
    const servers: NginxNode[] = [];
    const find = (nodes: NginxNode[]) => {
      for (const n of nodes) {
        if (n.name === 'server' && n.children) servers.push(n);
        else if (n.children && !n.opaque) find(n.children);
      }
    };
    find(root.children ?? []);
    let best: NginxNode | undefined;
    let bestN = -1;
    for (const s of servers) {
      const c = (s.children ?? []).filter((x) => x.name === 'location').length;
      if (c > bestN) {
        best = s;
        bestN = c;
      }
    }
    if (!best) return [];
    return (best.children ?? [])
      .filter((x) => x.name === 'location' && x.children)
      .map((x) => locationInfo(x))
      .filter((l) => !l.named)
      .map((l) => ({ mod: l.mod, path: l.path }));
  } catch {
    return [];
  }
}

/* ========================================================================== */
/* 4. BỘ SINH CẤU HÌNH                                                        */
/* ========================================================================== */

export type Scenario = 'static' | 'spa' | 'proxy' | 'php' | 'node' | 'loadbalancer' | 'redirect' | 'download' | 'gateway';
export type LbMethod = 'round_robin' | 'least_conn' | 'ip_hash';
export type RedirectKind = 'http2https' | 'www2apex' | 'apex2www' | 'migrate';
export type LocMod = '' | '=' | '^~' | '~' | '~*';
export type CacheMode = 'hashed' | 'moderate' | 'off';

export interface UpstreamServer {
  addr: string;
  weight: number;
  backup: boolean;
}
export interface Route {
  path: string;
  target: string;
  strip: boolean;
}
export interface CustomLocation {
  modifier: LocMod;
  path: string;
  body: string;
}

export interface GenOptions {
  scenario: Scenario;
  domains: string;
  // listen / ssl
  ssl: boolean;
  http2: boolean;
  legacyHttp2: boolean;
  http3: boolean;
  ipv6: boolean;
  redirectHttp: boolean;
  certMode: 'letsencrypt' | 'custom';
  certPath: string;
  keyPath: string;
  acme: boolean;
  acmeRoot: string;
  stapling: boolean;
  hsts: boolean;
  hstsSub: boolean;
  hstsPreload: boolean;
  // header bảo mật
  secHeaders: boolean;
  xfo: 'SAMEORIGIN' | 'DENY' | 'off';
  csp: 'off' | 'report-only' | 'enforce';
  cspValue: string;
  serverTokensOff: boolean;
  denyDotfiles: boolean;
  denySensitive: boolean;
  // nén / cache
  gzip: boolean;
  gzipMinLength: number;
  brotli: boolean;
  cacheMode: CacheMode;
  htmlNoCache: boolean;
  maxBody: string;
  // giới hạn
  rateLimit: boolean;
  rate: string;
  burst: number;
  zoneSize: string;
  limitConn: boolean;
  connLimit: number;
  // CORS
  cors: boolean;
  corsOrigins: string;
  corsCredentials: boolean;
  // truy cập
  basicAuth: boolean;
  authFile: string;
  authRealm: string;
  ipAllow: string;
  // log / lỗi
  accessLog: string;
  errorLog: string;
  jsonLog: boolean;
  errorPages: boolean;
  maintenance: 'off' | 'always' | 'flag';
  // nội dung
  root: string;
  index: string;
  // proxy
  upstreamName: string;
  servers: UpstreamServer[];
  lb: LbMethod;
  keepalive: number;
  maxFails: number;
  failTimeout: string;
  proxyLocation: string;
  stripPrefix: boolean;
  backendPath: string;
  backendHttps: boolean;
  websocket: boolean;
  buffering: boolean;
  connectTimeout: string;
  readTimeout: string;
  sendTimeout: string;
  // php
  fastcgiPass: string;
  phpFront: boolean;
  // download
  limitRate: boolean;
  limitRateAfter: string;
  limitRateValue: string;
  forceDownload: boolean;
  autoindex: boolean;
  // gateway
  routes: Route[];
  // redirect
  redirectKind: RedirectKind;
  redirectTarget: string;
  // location tuỳ chỉnh
  locations: CustomLocation[];
  fullConf: boolean;
}

export const SCENARIOS: { id: Scenario; label: string; desc: string }[] = [
  { id: 'static', label: 'Website tĩnh', desc: 'Phục vụ thư mục HTML/CSS/JS, cache theo loại file.' },
  { id: 'spa', label: 'SPA (React/Vue/Angular)', desc: 'try_files fallback về /index.html, asset cache lâu, HTML không cache.' },
  { id: 'proxy', label: 'Reverse proxy', desc: 'Chuyển tiếp tới 1 backend (hoặc nhóm upstream) kèm header chuẩn.' },
  { id: 'php', label: 'PHP-FPM', desc: 'fastcgi_pass socket/port, try_files, chặn thực thi file lạ.' },
  { id: 'node', label: 'Node.js / Next.js', desc: 'Proxy tới app Node, WebSocket, cache /_next/static.' },
  { id: 'loadbalancer', label: 'Load balancer', desc: 'Nhiều backend: round-robin, least_conn, ip_hash, weight, failover.' },
  { id: 'redirect', label: 'Chỉ redirect', desc: 'HTTP→HTTPS, www↔apex, chuyển miền 301 giữ nguyên path.' },
  { id: 'download', label: 'Tải file / CDN tĩnh', desc: 'File lớn, Range request, giới hạn tốc độ, CORS.' },
  { id: 'gateway', label: 'API gateway', desc: 'Định tuyến theo path, rate limit, CORS, trả lỗi JSON.' },
];

const DEFAULT_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'";

export function defaultOptions(scenario: Scenario = 'static'): GenOptions {
  const base: GenOptions = {
    scenario,
    domains: 'example.com www.example.com',
    ssl: true,
    http2: true,
    legacyHttp2: false,
    http3: false,
    ipv6: true,
    redirectHttp: true,
    certMode: 'letsencrypt',
    certPath: '/etc/ssl/certs/example.com.crt',
    keyPath: '/etc/ssl/private/example.com.key',
    acme: true,
    acmeRoot: '/var/www/certbot',
    stapling: false,
    hsts: true,
    hstsSub: false,
    hstsPreload: false,
    secHeaders: true,
    xfo: 'SAMEORIGIN',
    csp: 'off',
    cspValue: DEFAULT_CSP,
    serverTokensOff: true,
    denyDotfiles: true,
    denySensitive: false,
    gzip: true,
    gzipMinLength: 1024,
    brotli: false,
    cacheMode: 'moderate',
    htmlNoCache: true,
    maxBody: '10m',
    rateLimit: false,
    rate: '10r/s',
    burst: 20,
    zoneSize: '10m',
    limitConn: false,
    connLimit: 20,
    cors: false,
    corsOrigins: 'https://app.example.com',
    corsCredentials: false,
    basicAuth: false,
    authFile: '/etc/nginx/.htpasswd',
    authRealm: 'Restricted',
    ipAllow: '',
    accessLog: '',
    errorLog: '',
    jsonLog: false,
    errorPages: false,
    maintenance: 'off',
    root: '/var/www/example.com/html',
    index: 'index.html',
    upstreamName: 'app_backend',
    servers: [{ addr: '127.0.0.1:3000', weight: 1, backup: false }],
    lb: 'round_robin',
    keepalive: 0,
    maxFails: 3,
    failTimeout: '30s',
    proxyLocation: '/',
    stripPrefix: false,
    backendPath: '',
    backendHttps: false,
    websocket: false,
    buffering: true,
    connectTimeout: '5s',
    readTimeout: '60s',
    sendTimeout: '60s',
    fastcgiPass: 'unix:/run/php/php8.3-fpm.sock',
    phpFront: true,
    limitRate: false,
    limitRateAfter: '20m',
    limitRateValue: '5m',
    forceDownload: false,
    autoindex: false,
    routes: [
      { path: '/users/', target: '127.0.0.1:3001', strip: true },
      { path: '/orders/', target: '127.0.0.1:3002', strip: true },
    ],
    redirectKind: 'www2apex',
    redirectTarget: 'new-example.com',
    locations: [],
    fullConf: false,
  };
  switch (scenario) {
    case 'spa':
      return { ...base, root: '/var/www/example.com/dist', cacheMode: 'hashed' };
    case 'proxy':
      return { ...base, keepalive: 16 };
    case 'node':
      return { ...base, keepalive: 32, websocket: true, cacheMode: 'hashed', maxBody: '20m' };
    case 'loadbalancer':
      return {
        ...base,
        lb: 'least_conn',
        keepalive: 32,
        servers: [
          { addr: '10.0.0.11:8080', weight: 3, backup: false },
          { addr: '10.0.0.12:8080', weight: 2, backup: false },
          { addr: '10.0.0.13:8080', weight: 1, backup: true },
        ],
      };
    case 'php':
      return { ...base, root: '/var/www/example.com/public', index: 'index.php index.html', maxBody: '64m', cacheMode: 'moderate' };
    case 'redirect':
      return { ...base, redirectKind: 'www2apex' };
    case 'download':
      return { ...base, root: '/srv/files', cacheMode: 'off', htmlNoCache: false, maxBody: '1m', limitRate: false };
    case 'gateway':
      return { ...base, rateLimit: true, limitConn: true, cors: true, cacheMode: 'off', htmlNoCache: false, errorPages: false, keepalive: 0 };
    default:
      return base;
  }
}

/* ---------- tiện ích kiểm tra / escape ---------- */

const DOMAIN_RE = /^(?:\*\.|\.)?(?:[a-z0-9_-]+\.)*[a-z0-9_-]+$/i;

export function parseDomains(input: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const t of input.split(/[\s,;]+/).filter(Boolean)) {
    const low = t.toLowerCase();
    if (low === '_' || (DOMAIN_RE.test(low) && low.length <= 253)) {
      if (!valid.includes(low)) valid.push(low);
    } else invalid.push(t);
  }
  return { valid, invalid };
}

/** Bọc chuỗi trong dấu nháy kép nginx, escape \ và " */
export function nginxQuote(s: string): string {
  return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

const PATH_RE = /^[^\s;{}'"\\#]+$/;
const SIZE_RE = /^\d+[kKmMgG]?$/;
const TIME_RE = /^\d+(?:ms|s|m|h|d)?$/;
const RATE_RE = /^\d+r\/[sm]$/;
const ADDR_RE = /^(?:unix:\/[^\s;{}'"]+|(?:[A-Za-z0-9._-]+|\[[0-9a-fA-F:]+\])(?::\d{1,5})?)$/;
const IP_RE = /^(?:\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?|[0-9a-fA-F:]+(?:\/\d{1,3})?)$/;
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;

function clampInt(v: unknown, min: number, max: number, def: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

const block = (header: string, body: string[]): string[] => [header + ' {', ...body.map((l) => (l === '' ? '' : '    ' + l)), '}'];

function slugify(s: string): string {
  return s.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'site';
}

export interface GenResult {
  server: string;
  http: string;
  combined: string;
  fullConf: string;
  commands: string;
  warnings: string[];
  notes: string[];
  slug: string;
  certDomain: string;
}

export function generateNginx(input: GenOptions): GenResult {
  const warnings: string[] = [];
  const notes: string[] = [];
  const d = { ...defaultOptions(input.scenario), ...input };
  const sc = d.scenario;
  const pd = parseDomains(d.domains);
  if (pd.invalid.length) warnings.push(`Bỏ qua server_name không hợp lệ: ${pd.invalid.join(', ')}`);
  let domains = pd.valid;
  if (!domains.length) {
    domains = ['example.com'];
    warnings.push('Chưa có server_name hợp lệ — dùng "example.com" làm ví dụ.');
  }
  const d0 = domains[0];
  const certDomain = d0 === '_' ? 'example.com' : d0.replace(/^\*\./, '').replace(/^\./, '');
  const slug = slugify(certDomain);

  const safePath = (p: string, def: string, label: string): string => {
    const t = (p ?? '').trim();
    if (t && PATH_RE.test(t)) return t;
    if (t) warnings.push(`${label} chứa ký tự không an toàn (khoảng trắng, ; { } nháy) — dùng mặc định ${def}.`);
    return def;
  };

  const root = safePath(d.root, '/var/www/html', 'root');
  const indexFiles = (d.index || 'index.html').split(/\s+/).filter((x) => /^[\w.\-]+$/.test(x)).join(' ') || 'index.html';
  const maxBody = SIZE_RE.test(d.maxBody) ? d.maxBody : (warnings.push('client_max_body_size không hợp lệ — dùng 10m.'), '10m');
  const accessLog = safePath(d.accessLog, `/var/log/nginx/${slug}.access.log`, 'access_log');
  const errorLog = safePath(d.errorLog, `/var/log/nginx/${slug}.error.log`, 'error_log');
  const acmeRoot = safePath(d.acmeRoot, '/var/www/certbot', 'Thư mục webroot ACME');
  const authFile = safePath(d.authFile, '/etc/nginx/.htpasswd', 'auth_basic_user_file');
  const upName = /^[A-Za-z_][\w]*$/.test(d.upstreamName) ? d.upstreamName : 'app_backend';

  const useSsl = d.ssl && !(sc === 'redirect' && d.redirectKind === 'http2https');
  const crt = d.certMode === 'letsencrypt' ? `/etc/letsencrypt/live/${certDomain}/fullchain.pem` : safePath(d.certPath, `/etc/ssl/certs/${certDomain}.crt`, 'ssl_certificate');
  const key = d.certMode === 'letsencrypt' ? `/etc/letsencrypt/live/${certDomain}/privkey.pem` : safePath(d.keyPath, `/etc/ssl/private/${certDomain}.key`, 'ssl_certificate_key');
  const chain = d.certMode === 'letsencrypt' ? `/etc/letsencrypt/live/${certDomain}/chain.pem` : crt;

  const httpParts: string[][] = [];
  const addHttp = (lines: string[]) => httpParts.push(lines);

  /* ---------- header bảo mật (cấp server) ---------- */
  const hdrLines: string[] = [];
  const hdrNote: string[] = [];
  if (useSsl && d.hsts) {
    const v = ['max-age=63072000'];
    if (d.hstsSub) v.push('includeSubDomains');
    if (d.hstsPreload) v.push('preload');
    hdrNote.push(
      '# HSTS: trình duyệt sẽ ÉP dùng HTTPS cho domain trong 2 năm. Chỉ bật khi chắc chắn HTTPS chạy ổn.',
      '# includeSubDomains ảnh hưởng MỌI subdomain; "preload" đưa domain vào danh sách cứng của trình duyệt — gần như KHÔNG THỂ gỡ, đọc hstspreload.org trước.'
    );
    hdrLines.push(`add_header Strict-Transport-Security ${nginxQuote(v.join('; '))} always;`);
    if (d.hstsPreload && !d.hstsSub) warnings.push('HSTS preload yêu cầu includeSubDomains — hãy bật cả hai (hoặc tắt preload).');
  }
  if (d.secHeaders) {
    hdrLines.push('add_header X-Content-Type-Options "nosniff" always;');
    if (d.xfo !== 'off') hdrLines.push(`add_header X-Frame-Options ${d.xfo} always;`);
    hdrLines.push('add_header Referrer-Policy "strict-origin-when-cross-origin" always;');
    hdrLines.push('add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;');
  }
  if (d.csp !== 'off') {
    const name = d.csp === 'report-only' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
    hdrLines.push(`add_header ${name} ${nginxQuote(d.cspValue || DEFAULT_CSP)} always;`);
  }
  if (d.http3 && useSsl) hdrLines.push('add_header Alt-Svc \'h3=":443"; ma=86400\' always;');

  const headerBlock = (): string[] => {
    if (!hdrLines.length) return [];
    return ['# --- Header bảo mật (add_header ... always: gửi cả với phản hồi lỗi) ---', ...hdrNote, ...hdrLines, ''];
  };
  /** location có add_header riêng → phải lặp lại header cấp server (add_header KHÔNG kế thừa nếu cấp con có add_header) */
  const withHeaders = (extra: string[]): string[] => {
    if (!hdrLines.length) return extra;
    return [...extra, '# add_header ở location sẽ thay thế toàn bộ add_header của cấp server → lặp lại header bảo mật:', ...hdrLines];
  };

  /* ---------- CORS ---------- */
  const corsVar = `$cors_origin_${slug}`;
  const corsOrigins = d.cors
    ? d.corsOrigins.split(/[\s,]+/).filter(Boolean).filter((o) => {
        const ok = ORIGIN_RE.test(o);
        if (!ok) warnings.push(`Bỏ qua origin CORS không hợp lệ: ${o} (dạng đúng: https://app.example.com).`);
        return ok;
      })
    : [];
  const corsOn = d.cors && corsOrigins.length > 0;
  if (d.cors && !corsOn) warnings.push('CORS bật nhưng chưa có origin hợp lệ — bỏ qua phần CORS.');
  const corsHeaders = (): string[] => {
    if (!corsOn) return [];
    const L = [
      '# CORS: chỉ phản chiếu origin nằm trong map (KHÔNG dùng * khi có credentials)',
      `add_header Access-Control-Allow-Origin ${corsVar} always;`,
      'add_header Vary Origin always;',
      'add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;',
      'add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-Requested-With" always;',
      'add_header Access-Control-Max-Age 86400 always;',
    ];
    if (d.corsCredentials) L.push('add_header Access-Control-Allow-Credentials "true" always;');
    return L;
  };
  const corsPreflight = (): string[] => (corsOn ? ['# Preflight: trả 204 ngay (các header CORS ở trên được gửi kèm)', 'if ($request_method = OPTIONS) {', '    return 204;', '}'] : []);
  if (corsOn) {
    addHttp([
      '# Danh sách origin được phép CORS (khớp chính xác); origin lạ → biến rỗng → header không được gửi',
      `map $http_origin ${corsVar} {`,
      '    default "";',
      ...corsOrigins.map((o) => `    ${nginxQuote(o)} $http_origin;`),
      '}',
    ]);
  }

  /* ---------- giới hạn tốc độ ---------- */
  const reqZone = `req_${slug}`;
  const connZone = `conn_${slug}`;
  const rate = RATE_RE.test(d.rate) ? d.rate : (warnings.push('Tốc độ limit_req không hợp lệ (vd 10r/s) — dùng 10r/s.'), '10r/s');
  const zoneSize = SIZE_RE.test(d.zoneSize) ? d.zoneSize : '10m';
  const burst = clampInt(d.burst, 0, 100000, 20);
  const connLimit = clampInt(d.connLimit, 1, 100000, 20);
  if (d.rateLimit) {
    addHttp([
      '# Giới hạn tốc độ request theo IP client ($binary_remote_addr tiết kiệm bộ nhớ hơn $remote_addr)',
      `limit_req_zone $binary_remote_addr zone=${reqZone}:${zoneSize} rate=${rate};`,
    ]);
  }
  if (d.limitConn) {
    addHttp(['# Giới hạn số kết nối đồng thời theo IP', `limit_conn_zone $binary_remote_addr zone=${connZone}:${zoneSize};`]);
  }

  /* ---------- log JSON ---------- */
  const jsonFmt = `json_${slug}`;
  if (d.jsonLog) {
    addHttp([
      '# Log dạng JSON (dễ đẩy vào ELK/Loki). escape=json xử lý dấu nháy/ký tự đặc biệt',
      `log_format ${jsonFmt} escape=json '{"time":"$time_iso8601","remote_addr":"$remote_addr","host":"$host","request":"$request","status":$status,"body_bytes_sent":$body_bytes_sent,"request_time":$request_time,"upstream_response_time":"$upstream_response_time","http_referer":"$http_referer","http_user_agent":"$http_user_agent"}\';`,
    ]);
  }

  /* ---------- upstream / proxy ---------- */
  const proxyLike = sc === 'proxy' || sc === 'node' || sc === 'loadbalancer' || sc === 'gateway';
  const upServers: UpstreamServer[] = [];
  if (sc === 'proxy' || sc === 'node' || sc === 'loadbalancer') {
    for (const s of d.servers) {
      const a = (s.addr ?? '').trim();
      if (!a) continue;
      if (!ADDR_RE.test(a)) {
        warnings.push(`Bỏ qua địa chỉ backend không hợp lệ: ${a}`);
        continue;
      }
      upServers.push({ addr: a, weight: clampInt(s.weight, 1, 1000, 1), backup: !!s.backup });
    }
    if (!upServers.length) {
      upServers.push({ addr: '127.0.0.1:3000', weight: 1, backup: false });
      warnings.push('Chưa có backend hợp lệ — dùng 127.0.0.1:3000 làm ví dụ.');
    }
  }
  const keepalive = clampInt(d.keepalive, 0, 10000, 0);
  const useUpstream = (sc === 'proxy' || sc === 'node' || sc === 'loadbalancer') && (upServers.length > 1 || keepalive > 0 || sc === 'loadbalancer');
  const scheme = d.backendHttps ? 'https' : 'http';
  const lb: LbMethod = sc === 'loadbalancer' || upServers.length > 1 ? d.lb : 'round_robin';

  if (useUpstream) {
    const L: string[] = [];
    L.push(`# Nhóm backend "${upName}"`);
    L.push('# Health check THỤ ĐỘNG: sau max_fails lần lỗi trong fail_timeout, server bị loại tạm thời rồi thử lại.');
    L.push('# Health check CHỦ ĐỘNG (health_check) chỉ có ở nginx Plus hoặc module bên thứ ba.');
    const body: string[] = [];
    if (lb === 'least_conn') body.push('least_conn;  # gửi tới backend đang có ít kết nối nhất');
    else if (lb === 'ip_hash') body.push('ip_hash;  # cùng IP client → cùng backend (sticky). Không dùng được "backup"');
    else if (upServers.length > 1) body.push('# round-robin (mặc định): lần lượt từng backend, tôn trọng weight');
    for (const s of upServers) {
      const opts: string[] = [];
      if (s.weight > 1) opts.push(`weight=${s.weight}`);
      if (upServers.length > 1 || s.addr) {
        opts.push(`max_fails=${clampInt(d.maxFails, 0, 1000, 3)}`);
        opts.push(`fail_timeout=${TIME_RE.test(d.failTimeout) ? d.failTimeout : '30s'}`);
      }
      if (s.backup) {
        if (lb === 'ip_hash') warnings.push(`Backend ${s.addr}: "backup" không dùng được với ip_hash — đã bỏ.`);
        else opts.push('backup');
      }
      body.push(`server ${s.addr}${opts.length ? ' ' + opts.join(' ') : ''};`);
    }
    if (keepalive > 0) {
      body.push('');
      body.push(`keepalive ${keepalive};  # giữ sẵn kết nối tới backend (cần proxy_http_version 1.1 + Connection "")`);
    }
    if (upServers.some((s) => /^[A-Za-z]/.test(s.addr) && !s.addr.startsWith('unix:'))) {
      L.push('# Lưu ý: tên miền trong upstream chỉ được phân giải MỘT LẦN khi nginx khởi động/reload.');
    }
    addHttp([...L, ...block(`upstream ${upName}`, body)]);
  }

  const wsMapName = '$connection_upgrade';
  if (proxyLike && d.websocket) {
    addHttp([
      '# WebSocket: nếu client gửi Upgrade → chuyển tiếp "upgrade", ngược lại để rỗng (giữ được keepalive tới backend).',
      '# Nếu file khác đã khai báo map này, hãy bỏ đoạn này để tránh lỗi "duplicate variable".',
      `map $http_upgrade ${wsMapName} {`,
      '    default upgrade;',
      "    ''      '';",
      '}',
    ]);
  }

  const proxyTimeouts = {
    c: TIME_RE.test(d.connectTimeout) ? d.connectTimeout : '5s',
    r: TIME_RE.test(d.readTimeout) ? d.readTimeout : '60s',
    s: TIME_RE.test(d.sendTimeout) ? d.sendTimeout : '60s',
  };

  const proxyServerLevel = (): string[] => {
    const L: string[] = ['# --- Cấu hình proxy dùng chung (đặt ở cấp server để mọi location proxy_pass kế thừa) ---'];
    L.push('proxy_http_version 1.1;');
    L.push('proxy_set_header Host $host;');
    L.push('proxy_set_header X-Real-IP $remote_addr;');
    L.push('proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;');
    L.push('proxy_set_header X-Forwarded-Proto $scheme;');
    if (sc === 'gateway') L.push('proxy_set_header X-Request-ID $request_id;');
    if (d.websocket) {
      L.push('proxy_set_header Upgrade $http_upgrade;');
      L.push(`proxy_set_header Connection ${wsMapName};`);
    } else {
      L.push('proxy_set_header Connection "";  # xoá "Connection: close" mặc định để keepalive hoạt động');
    }
    L.push(`proxy_connect_timeout ${proxyTimeouts.c};`);
    L.push(`proxy_send_timeout ${proxyTimeouts.s};`);
    L.push(`proxy_read_timeout ${proxyTimeouts.r};` + (d.websocket ? '  # WebSocket: tăng (vd 3600s) hoặc để app gửi ping' : ''));
    if (d.buffering) L.push('proxy_buffering on;');
    else L.push('proxy_buffering off;  # cần cho SSE / streaming / long-polling (đổi lại tốn kết nối backend lâu hơn)');
    if ((sc === 'proxy' || sc === 'node' || sc === 'loadbalancer') && upServers.length > 1) {
      L.push('# Khi backend lỗi/timeout, thử backend kế tiếp (chỉ an toàn cho request idempotent)');
      L.push('proxy_next_upstream error timeout http_502 http_503 http_504;');
      L.push('proxy_next_upstream_tries 3;');
      L.push('proxy_next_upstream_timeout 10s;');
    }
    if (d.backendHttps) {
      L.push('proxy_ssl_server_name on;  # gửi SNI tới backend HTTPS');
      L.push('# proxy_ssl_verify on; proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;  # xác minh chứng chỉ backend');
    }
    if (corsOn) {
      L.push('proxy_hide_header Access-Control-Allow-Origin;  # tránh trùng header CORS nếu backend cũng gửi');
      L.push('proxy_hide_header Access-Control-Allow-Credentials;');
    }
    L.push('');
    return L;
  };

  const normLoc = (p: string): string => {
    let t = (p || '/').trim();
    if (!PATH_RE.test(t)) {
      warnings.push(`Đường dẫn location "${t}" không hợp lệ — dùng "/".`);
      t = '/';
    }
    if (!t.startsWith('/')) t = '/' + t;
    return t;
  };
  const normSlash = (p: string): string => {
    let t = normLoc(p);
    if (t !== '/' && !t.endsWith('/')) t += '/';
    return t;
  };

  const passTarget = (uri: string, addrOverride?: string): string => {
    let base: string;
    if (addrOverride) base = `${scheme}://${addrOverride}`;
    else if (useUpstream) base = `${scheme}://${upName}`;
    else base = `${scheme}://${upServers[0].addr}`;
    if (!uri) return base;
    if (!useUpstream && !addrOverride && upServers[0].addr.startsWith('unix:')) return `${base}:${uri}`;
    if (addrOverride && addrOverride.startsWith('unix:')) return `${base}:${uri}`;
    return base + uri;
  };

  /* ---------- tạo các location ---------- */
  const cacheHashed = '"public, max-age=31536000, immutable"';
  const cacheModerate = '"public, max-age=2592000"';
  const assetRegex = '\\.(?:css|js|mjs|woff2?|ttf|otf|eot|svg|png|jpe?g|gif|webp|avif|ico|webmanifest)$';

  const assetLocation = (tryFiles: boolean): string[] => {
    if (d.cacheMode === 'off') return [];
    const val = d.cacheMode === 'hashed' ? cacheHashed : cacheModerate;
    const body: string[] = [];
    body.push(d.cacheMode === 'hashed'
      ? '# immutable + 1 năm: CHỈ an toàn nếu tên file có hash (app.3f2a1c.js). File không hash sẽ bị cache cũ mãi → chọn "30 ngày".'
      : '# Cache 30 ngày cho file tĩnh (không immutable, an toàn với file không đổi tên).');
    if (tryFiles) body.push('try_files $uri =404;');
    body.push(...withHeaders([`add_header Cache-Control ${val} always;`, ...corsHeaders()]));
    body.push('access_log off;');
    return ['', '# Cache theo loại file (regex: khớp theo thứ tự trong file, khớp đầu tiên thắng)', ...block(`location ~* ${assetRegex}`, body)];
  };

  const htmlLocation = (exact: string | null): string[] => {
    if (!d.htmlNoCache) return [];
    const body = withHeaders(['add_header Cache-Control "no-cache" always;  # luôn xác thực lại với server (ETag) để người dùng nhận bản mới']);
    if (exact) return ['', `# HTML không cache cứng để deploy mới có hiệu lực ngay`, ...block(`location = ${exact}`, [...body])];
    return ['', '# HTML không cache cứng', ...block('location ~* \\.html?$', body)];
  };

  const acmeLocation = (relaxAccess: boolean): string[] => {
    if (!d.acme) return [];
    const body = [`root ${acmeRoot};`, 'default_type "text/plain";', 'try_files $uri =404;'];
    if (relaxAccess) {
      if (d.basicAuth) body.push('auth_basic off;');
      if (d.ipAllow.trim()) body.push('allow all;');
    }
    return ['# Xác thực Let\'s Encrypt (HTTP-01, certbot --webroot). ^~ để regex bên dưới không chặn nhầm', ...block('location ^~ /.well-known/acme-challenge/', body), ''];
  };

  const denyLocations = (): string[] => {
    const L: string[] = [];
    if (d.denyDotfiles) {
      L.push('# Chặn file ẩn (.git, .env, .htaccess...) — trừ /.well-known (ACME, security.txt)');
      L.push(...block('location ~ /\\.(?!well-known)', ['deny all;', 'access_log off;', 'log_not_found off;']));
      L.push('');
    }
    if (d.denySensitive) {
      L.push('# Chặn file nhạy cảm / backup / cấu hình thường bị lộ nhầm');
      L.push(...block('location ~* \\.(?:bak|backup|old|orig|sql|sqlite3?|ini|conf|cfg|log|swp|dist|lock|yml|yaml)$', ['deny all;', 'access_log off;', 'log_not_found off;']));
      L.push(...block('location ~* ^/(?:node_modules|vendor|composer\\.json|package(?:-lock)?\\.json|Dockerfile|docker-compose\\.ya?ml)(?:/|$)', ['deny all;']));
      L.push('');
    }
    return L;
  };

  const mainLocations = (): string[] => {
    const L: string[] = [];
    const notFoundOrFlag = (): string[] =>
      d.maintenance === 'flag' ? ['# Chế độ bảo trì: tạo file /var/www/maintenance.flag để bật, xoá file để tắt (không cần reload)', 'if (-f /var/www/maintenance.flag) {', '    return 503;', '}', ''] : [];
    switch (sc) {
      case 'static': {
        L.push('# Phục vụ file tĩnh; không tồn tại → 404');
        L.push(...block('location /', [...notFoundOrFlag(), 'try_files $uri $uri/ =404;', ...(corsOn ? ['', ...withHeaders(corsHeaders()), ...corsPreflight()] : [])]));
        L.push(...assetLocation(false), ...htmlLocation(null));
        break;
      }
      case 'spa': {
        L.push('# SPA: mọi đường dẫn không phải file thật → /index.html để router phía client xử lý');
        L.push(...block('location /', [...notFoundOrFlag(), 'try_files $uri $uri/ /index.html;', ...(corsOn ? ['', ...withHeaders(corsHeaders()), ...corsPreflight()] : [])]));
        L.push(...assetLocation(true), ...htmlLocation('/index.html'));
        break;
      }
      case 'php': {
        L.push(...block('location /', [...notFoundOrFlag(), d.phpFront ? '# Front controller (Laravel/Symfony/WordPress pretty URL): file/thư mục thật, nếu không → index.php' : '# Chỉ phục vụ file thật', d.phpFront ? 'try_files $uri $uri/ /index.php?$query_string;' : 'try_files $uri $uri/ =404;']));
        const fp = d.fastcgiPass.trim();
        const fpOk = /^(?:unix:\/[^\s;{}'"]+|[A-Za-z0-9._-]+:\d{1,5}|\[[0-9a-fA-F:]+\]:\d{1,5})$/.test(fp);
        if (!fpOk) warnings.push('fastcgi_pass không hợp lệ (vd unix:/run/php/php8.3-fpm.sock hoặc 127.0.0.1:9000) — dùng socket mặc định.');
        L.push('');
        L.push('# PHP-FPM');
        L.push(...block('location ~ \\.php$', [
          'try_files $uri =404;  # chặn thực thi file không tồn tại (lỗ hổng cgi.fix_pathinfo)',
          'include fastcgi_params;',
          'fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;',
          'fastcgi_param HTTP_PROXY "";  # chống httpoxy',
          `fastcgi_pass ${fpOk ? fp : 'unix:/run/php/php8.3-fpm.sock'};`,
          'fastcgi_index index.php;',
          'fastcgi_read_timeout 60s;',
        ]));
        L.push(...assetLocation(true));
        break;
      }
      case 'download': {
        const dlBody: string[] = [...notFoundOrFlag()];
        dlBody.push('# Range request (tiếp tục tải, tua video) được nginx hỗ trợ sẵn cho file tĩnh: Accept-Ranges: bytes');
        dlBody.push('try_files $uri =404;');
        dlBody.push(`autoindex ${d.autoindex ? 'on' : 'off'};` + (d.autoindex ? '  # chỉ bật cho thư mục công khai có chủ đích' : ''));
        if (d.autoindex) dlBody.push('autoindex_exact_size off;', 'autoindex_localtime on;');
        if (d.limitRate) {
          const after = SIZE_RE.test(d.limitRateAfter) ? d.limitRateAfter : '20m';
          const val = SIZE_RE.test(d.limitRateValue) ? d.limitRateValue : '5m';
          dlBody.push(`limit_rate_after ${after};  # N MB đầu tải full tốc độ`, `limit_rate ${val};  # sau đó giới hạn byte/giây MỖI kết nối`);
        }
        dlBody.push('# aio threads;  # bật nếu nginx build với --with-threads và file rất lớn');
        dlBody.push(...withHeaders([`add_header Cache-Control ${d.cacheMode === 'off' ? '"public, max-age=3600"' : d.cacheMode === 'hashed' ? cacheHashed : cacheModerate} always;`, ...corsHeaders()]));
        dlBody.push(...corsPreflight());
        L.push('# Thư mục tải file / CDN-style');
        L.push(...block('location /', dlBody));
        if (d.forceDownload) {
          L.push('', '# Ép trình duyệt tải xuống thay vì mở (các định dạng đóng gói)');
          L.push(...block('location ~* \\.(?:zip|tar|gz|tgz|bz2|xz|7z|rar|iso|img|dmg|pkg|deb|rpm|exe|msi|apk)$', [
            'try_files $uri =404;',
            ...withHeaders(['add_header Content-Disposition "attachment" always;', 'add_header Cache-Control "public, max-age=86400" always;', ...corsHeaders()]),
          ]));
        }
        break;
      }
      case 'proxy':
      case 'node':
      case 'loadbalancer': {
        const loc = normLoc(d.proxyLocation);
        const isRoot = loc === '/';
        const locPath = isRoot ? '/' : normSlash(loc);
        let uri = '';
        if (!isRoot && d.stripPrefix) {
          let bp = (d.backendPath || '/').trim();
          if (!PATH_RE.test(bp) || /[$]/.test(bp)) {
            warnings.push('backendPath không hợp lệ — dùng "/".');
            bp = '/';
          }
          if (!bp.startsWith('/')) bp = '/' + bp;
          if (!bp.endsWith('/')) bp += '/';
          uri = bp;
        } else if (isRoot && d.backendPath && d.backendPath.trim() !== '' && d.backendPath.trim() !== '/') {
          let bp = d.backendPath.trim();
          if (PATH_RE.test(bp) && !bp.includes('$')) {
            if (!bp.startsWith('/')) bp = '/' + bp;
            if (!bp.endsWith('/')) bp += '/';
            uri = bp;
          }
        }
        const target = passTarget(uri);
        const pbody: string[] = [...notFoundOrFlag()];
        pbody.push(
          '# proxy_pass và dấu "/":',
          uri
            ? `#  - proxy_pass có phần URI ("${uri}") → phần khớp location "${locPath}" bị THAY bằng "${uri}". Ví dụ ${locPath}abc → ${uri}abc`
            : `#  - proxy_pass KHÔNG có URI (không "/" sau host:port) → giữ nguyên đường dẫn gốc, ví dụ ${locPath}abc → ${locPath}abc`,
          '#  - Quy tắc nhớ: location và URI trong proxy_pass nên cùng có hoặc cùng không có "/" ở cuối.'
        );
        pbody.push(`proxy_pass ${target};`);
        if (corsOn) pbody.push('', ...withHeaders(corsHeaders()), ...corsPreflight());
        L.push('# Chuyển tiếp tới backend');
        L.push(...block(`location ${locPath}`, pbody));
        if (!isRoot && d.stripPrefix) notes.push(`proxy_pass ${target}: request ${locPath}users → backend nhận ${uri}users (tiền tố ${locPath} bị bỏ/thay).`);
        else if (!isRoot) notes.push(`proxy_pass ${target} (không có URI): request ${locPath}users → backend nhận nguyên ${locPath}users.`);
        if (sc === 'node') {
          L.push('');
          L.push('# Next.js: file build có hash → cache lâu, nginx thêm Cache-Control (xoá nếu app không phải Next.js)');
          L.push(...block('location /_next/static/', [`proxy_pass ${passTarget('')};`, ...withHeaders(['add_header Cache-Control "public, max-age=31536000, immutable" always;'])]));
        }
        break;
      }
      case 'gateway': {
        L.push('# API gateway: mỗi route một location tiền tố. "strip" = bỏ tiền tố khi gửi tới service (nhờ "/" cuối proxy_pass)');
        const used = new Set<string>();
        for (const r of d.routes) {
          const addr = (r.target ?? '').trim();
          if (!addr) continue;
          if (!ADDR_RE.test(addr)) {
            warnings.push(`Bỏ qua route có target không hợp lệ: ${addr}`);
            continue;
          }
          const p = normSlash(r.path);
          if (p === '/' || used.has(p)) {
            warnings.push(`Route "${p}" trùng hoặc là "/" — bỏ qua (location / dùng cho 404 JSON).`);
            continue;
          }
          used.add(p);
          const body: string[] = [];
          body.push(`proxy_pass ${passTarget(r.strip ? '/' : '', addr)};`);
          if (corsOn) body.push('', ...withHeaders(corsHeaders()), ...corsPreflight());
          L.push(...block(`location ${p}`, body));
          L.push('');
        }
        if (d.rateLimit || d.limitConn) {
          L.push('# Bị giới hạn tốc độ (429) → trả JSON thay vì trang HTML mặc định');
          L.push('error_page 429 = @rate_limited;');
          L.push(...block('location @rate_limited', ['default_type application/json;', ...withHeaders(['add_header Retry-After 1 always;']), `return 429 '{"error":"too_many_requests"}';`]));
          L.push('');
        }
        L.push('# Mọi đường dẫn khác: 404 dạng JSON');
        L.push(...block('location /', ['default_type application/json;', `return 404 '{"error":"not_found"}';`]));
        break;
      }
      default:
        break;
    }
    return L;
  };

  const customLocations = (): string[] => {
    const L: string[] = [];
    const seen = new Set<string>();
    for (const c of d.locations) {
      if (!c || !c.path.trim()) continue;
      const mod = (['', '=', '^~', '~', '~*'] as string[]).includes(c.modifier) ? c.modifier : '';
      let path = c.path.trim();
      if (!PATH_RE.test(path)) path = nginxQuote(path);
      const k = `${mod}|${path}`;
      if (seen.has(k)) {
        warnings.push(`Location tuỳ chỉnh trùng: ${mod} ${path} — bỏ qua bản lặp.`);
        continue;
      }
      seen.add(k);
      const body = c.body.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l, i, arr) => !(l === '' && (i === 0 || i === arr.length - 1)));
      L.push('', `# Location tuỳ chỉnh`, ...block(`location ${mod ? mod + ' ' : ''}${path}`, body));
    }
    return L;
  };

  /* ---------- khối ssl ---------- */
  const sslLines = (): string[] => {
    const L: string[] = [];
    L.push('# --- TLS: Mozilla "intermediate" (ssl-config.mozilla.org) ---');
    L.push(`ssl_certificate ${crt};`);
    L.push(`ssl_certificate_key ${key};`);
    L.push('ssl_session_timeout 1d;');
    L.push('ssl_session_cache shared:MozSSL:10m;  # ≈ 40.000 phiên');
    L.push('ssl_session_tickets off;');
    L.push('');
    L.push('ssl_protocols TLSv1.2 TLSv1.3;');
    L.push('ssl_ecdh_curve X25519:prime256v1:secp384r1;');
    L.push('ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:DHE-RSA-CHACHA20-POLY1305;');
    L.push('ssl_prefer_server_ciphers off;');
    L.push('# Tuỳ chọn (cho cipher DHE): openssl dhparam -out /etc/nginx/dhparam.pem 2048  rồi  ssl_dhparam /etc/nginx/dhparam.pem;');
    if (d.stapling) {
      L.push('');
      L.push('# OCSP stapling. Lưu ý: Let\'s Encrypt đã ngừng OCSP (2025) → chứng chỉ mới không có OCSP URL, nginx sẽ cảnh báo "ssl_stapling ignored".');
      L.push('ssl_stapling on;');
      L.push('ssl_stapling_verify on;');
      L.push(`ssl_trusted_certificate ${chain};`);
      L.push('resolver 1.1.1.1 8.8.8.8 valid=300s;');
      L.push('resolver_timeout 5s;');
    }
    L.push('');
    return L;
  };

  const compressionLines = (): string[] => {
    const L: string[] = [];
    if (d.gzip) {
      L.push('# --- Nén gzip (text/html luôn được nén; không liệt kê lại) ---');
      L.push('gzip on;');
      L.push('gzip_vary on;  # thêm "Vary: Accept-Encoding" cho cache/CDN');
      L.push('gzip_proxied any;');
      L.push('gzip_comp_level 5;');
      L.push(`gzip_min_length ${clampInt(d.gzipMinLength, 0, 10_000_000, 1024)};`);
      L.push('gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml application/rss+xml application/atom+xml image/svg+xml font/ttf font/otf application/wasm;');
      L.push('');
    }
    if (d.brotli) {
      L.push('# --- Nén Brotli: cần module ngx_brotli (Debian/Ubuntu: apt install libnginx-mod-http-brotli-filter libnginx-mod-http-brotli-static) ---');
      L.push('# Không có module → nginx -t báo "unknown directive brotli". Có thể chạy song song với gzip.');
      L.push('brotli on;');
      L.push('brotli_comp_level 5;');
      L.push('brotli_min_length 1024;');
      L.push('brotli_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml image/svg+xml font/ttf font/otf application/wasm;');
      L.push('');
    }
    return L;
  };

  const limitLines = (): string[] => {
    const L: string[] = [];
    if (d.rateLimit || d.limitConn) L.push('# --- Giới hạn truy cập ---');
    if (d.rateLimit) {
      L.push(`limit_req zone=${reqZone} burst=${burst} nodelay;  # burst: số request vượt mức được chấp nhận ngay; nodelay: không làm chậm`);
      L.push('limit_req_status 429;');
      L.push('limit_req_log_level warn;');
    }
    if (d.limitConn) {
      L.push(`limit_conn ${connZone} ${connLimit};`);
      L.push('limit_conn_status 429;');
    }
    if (L.length) L.push('');
    return L;
  };

  const accessLines = (): string[] => {
    const L: string[] = [];
    const ips = d.ipAllow.split(/[\s,]+/).filter(Boolean).filter((ip) => {
      const ok = IP_RE.test(ip);
      if (!ok) warnings.push(`Bỏ qua IP/CIDR không hợp lệ: ${ip}`);
      return ok;
    });
    if (d.basicAuth || ips.length) L.push('# --- Kiểm soát truy cập ---');
    if (ips.length) {
      for (const ip of ips) L.push(`allow ${ip};`);
      L.push('deny all;');
      if (d.basicAuth) L.push('satisfy all;  # cần thoả CẢ IP hợp lệ VÀ mật khẩu (đổi thành any nếu chỉ cần một trong hai)');
    }
    if (d.basicAuth) {
      L.push(`auth_basic ${nginxQuote(d.authRealm.replace(/["\\\n\r]/g, '') || 'Restricted')};`);
      L.push(`auth_basic_user_file ${authFile};  # tạo bằng: htpasswd -c ${authFile} tên_user`);
    }
    if (L.length) L.push('');
    return L;
  };

  const logLines = (): string[] => {
    const L = ['# --- Log ---'];
    L.push(`access_log ${accessLog}${d.jsonLog ? ' ' + jsonFmt : ''};`);
    L.push(`error_log ${errorLog} warn;`);
    L.push('');
    return L;
  };

  const errorPageLines = (): string[] => {
    const L: string[] = [];
    if (d.errorPages && sc !== 'redirect') {
      L.push('# --- Trang lỗi tuỳ chỉnh (tạo file 404.html / 50x.html trong thư mục bên dưới) ---');
      L.push('error_page 404 /404.html;');
      L.push('error_page 500 502 503 504 /50x.html;');
      L.push('');
    }
    return L;
  };
  const errorPageLocations = (): string[] =>
    d.errorPages && sc !== 'redirect'
      ? ['# Trang lỗi chỉ dùng nội bộ (internal): client không truy cập trực tiếp được', ...block('location ~ ^/(?:404|50x)\\.html$', ['root /usr/share/nginx/html;', 'internal;']), '']
      : [];

  const maintenanceLines = (): { top: string[]; locs: string[] } => {
    if (d.maintenance === 'off' || sc === 'redirect') return { top: [], locs: [] };
    return {
      top: ['# --- Chế độ bảo trì ---', 'error_page 503 @maintenance;', ''],
      locs: [
        '# Trang bảo trì (503 + Retry-After để bot/SEO hiểu là tạm thời). Đặt file /var/www/maintenance/maintenance.html',
        ...block('location @maintenance', ['root /var/www/maintenance;', 'rewrite ^ /maintenance.html break;', ...withHeaders(['add_header Retry-After 3600 always;'])]),
        '',
      ],
    };
  };

  /* ---------- listen ---------- */
  const listenHttp = (defaultServer = false): string[] => {
    const ds = defaultServer ? ' default_server' : '';
    return [`listen 80${ds};`, ...(d.ipv6 ? [`listen [::]:80${ds};`] : [])];
  };
  let quicUsed = false;
  const listenHttps = (): string[] => {
    const L: string[] = [];
    const h2 = d.http2 && d.legacyHttp2 ? ' http2' : '';
    L.push(`listen 443 ssl${h2};`);
    if (d.ipv6) L.push(`listen [::]:443 ssl${h2};`);
    if (d.http3 && !quicUsed) {
      quicUsed = true;
      L.push('# HTTP/3 (QUIC, UDP 443): cần nginx >= 1.25 build có http_v3_module và mở UDP 443 trên firewall');
      L.push('listen 443 quic reuseport;');
      if (d.ipv6) L.push('listen [::]:443 quic reuseport;');
    }
    if (d.http2 && !d.legacyHttp2) L.push('http2 on;  # nginx >= 1.25.1. Bản cũ hơn: dùng "listen 443 ssl http2;"');
    if (d.http3) L.push('http3 on;');
    return L;
  };

  const serverNamesLine = (names: string[]) => `server_name ${names.join(' ')};`;

  const commonServerTop = (names: string[], isHttps: boolean): string[] => {
    const L: string[] = [];
    L.push(...(isHttps ? listenHttps() : listenHttp()));
    L.push(serverNamesLine(names));
    L.push('');
    if (isHttps) L.push(...sslLines());
    if (d.serverTokensOff) L.push('server_tokens off;  # ẩn phiên bản nginx', '');
    return L;
  };

  /* ---------- ghép server ---------- */
  const servers: string[][] = [];
  const header: string[] = [
    '# Tạo bởi GE Tools — Nginx Config Generator',
    `# Kịch bản: ${SCENARIOS.find((s) => s.id === sc)?.label ?? sc}`,
    '# Kiểm tra trước khi áp dụng:  sudo nginx -t   rồi   sudo nginx -s reload',
    '',
  ];

  if (sc === 'redirect') {
    const kind = d.redirectKind;
    const bare = certDomain.replace(/^www\./, '');
    let from: string[] = domains;
    let toHost = '';
    if (kind === 'www2apex') {
      from = ['www.' + bare];
      toHost = bare;
    } else if (kind === 'apex2www') {
      from = [bare];
      toHost = 'www.' + bare;
    } else if (kind === 'migrate') {
      const t = parseDomains(d.redirectTarget).valid.filter((x) => x !== '_' && !x.startsWith('*') && !x.startsWith('.'))[0];
      if (!t) {
        warnings.push('Tên miền đích không hợp lệ — dùng new-example.com làm ví dụ.');
        toHost = 'new-example.com';
      } else toHost = t;
    }
    if (kind === 'http2https') {
      const body = [...listenHttp(false), serverNamesLine(domains), '', ...(d.serverTokensOff ? ['server_tokens off;', ''] : []), ...logLines(), ...acmeLocation(false)];
      body.push('# Chuyển mọi request HTTP sang HTTPS, giữ nguyên host + đường dẫn + query ($request_uri)');
      body.push(...block('location /', ['return 301 https://$host$request_uri;']));
      servers.push(block('server', body));
      notes.push('301 là chuyển hướng vĩnh viễn (trình duyệt/Google ghi nhớ). Khi đang thử nghiệm có thể dùng 302 để tránh bị cache.');
    } else {
      const certD = from[0];
      const target = useSsl ? `https://${toHost}$request_uri` : `$scheme://${toHost}$request_uri`;
      if (useSsl) {
        const sslServer = [
          ...listenHttps(),
          serverNamesLine(from),
          '',
          ...sslLines(),
          ...(d.serverTokensOff ? ['server_tokens off;', ''] : []),
          ...logLines(),
          `return 301 ${target};`,
        ];
        const certNote = d.certMode === 'letsencrypt' && certD !== certDomain ? [`# Cần chứng chỉ cho ${certD}: certbot certonly --webroot -w ${acmeRoot} -d ${certD}`] : [];
        const httpServer = [...listenHttp(false), serverNamesLine(from), '', ...(d.serverTokensOff ? ['server_tokens off;', ''] : []), ...acmeLocation(false)];
        httpServer.push(...block('location /', [`return 301 ${target};`]));
        if (d.redirectHttp) servers.push(block('server', httpServer));
        servers.push([...certNote, ...block('server', sslServer)]);
      } else {
        servers.push(block('server', [...listenHttp(false), serverNamesLine(from), '', ...(d.serverTokensOff ? ['server_tokens off;', ''] : []), ...logLines(), ...acmeLocation(false), ...block('location /', [`return 301 ${target};`])]));
      }
      notes.push('$request_uri chứa đường dẫn + query string gốc nên URL cũ được giữ nguyên sau khi chuyển hướng.');
      if (kind === 'www2apex' || kind === 'apex2www') notes.push(`Cấu hình này chỉ xử lý host ${from[0]} → ${toHost}. Server phục vụ chính (${toHost}) cần khai báo riêng.`);
      if (kind === 'migrate') notes.push('Chuyển miền: giữ máy chủ/cert của miền cũ ít nhất vài tháng để redirect 301 còn hoạt động; thêm miền mới vào Google Search Console (Change of Address).');
    }
  } else {
    const mnt = maintenanceLines();
    const alwaysMaint = d.maintenance === 'always';
    const buildMain = (isHttps: boolean): string[] => {
      const B: string[] = [];
      B.push(...commonServerTop(domains, isHttps));
      const needsRoot = !proxyLike;
      if (needsRoot) {
        B.push(`root ${root};`, `index ${indexFiles};`, '');
      }
      B.push(`client_max_body_size ${maxBody};  # mặc định 1m; upload lớn hơn sẽ nhận lỗi 413`, '');
      B.push(...compressionLines());
      if (isHttps || !useSsl) B.push(...headerBlock());
      B.push(...limitLines());
      B.push(...accessLines());
      B.push(...logLines());
      B.push(...errorPageLines(), ...mnt.top);
      if (proxyLike && !alwaysMaint) B.push(...proxyServerLevel());
      B.push(...acmeLocationForMain(isHttps));
      B.push(...errorPageLocations(), ...mnt.locs);
      if (alwaysMaint) {
        B.push('# Bảo trì BẬT: mọi request trả 503', ...block('location /', ['return 503;']));
      } else {
        B.push(...denyLocations());
        B.push(...mainLocations());
        B.push(...customLocations());
      }
      // dọn dòng trống thừa cuối
      while (B.length && B[B.length - 1] === '') B.pop();
      return B;
    };
    const acmeLocationForMain = (isHttps: boolean): string[] => (!useSsl && !isHttps ? acmeLocation(true) : []);

    if (useSsl) {
      if (d.redirectHttp) {
        const rb = [...listenHttp(false), serverNamesLine(domains), '', ...(d.serverTokensOff ? ['server_tokens off;', ''] : []), ...acmeLocation(false)];
        rb.push('# Mọi request HTTP → HTTPS (301 vĩnh viễn, giữ nguyên host + path + query)');
        rb.push(...block('location /', ['return 301 https://$host$request_uri;']));
        servers.push(block('server', rb));
      }
      servers.push(block('server', buildMain(true)));
    } else {
      servers.push(block('server', buildMain(false)));
      notes.push('Chưa bật HTTPS: dùng cấu hình này để chạy certbot, sau đó bật "HTTPS" và tạo lại.');
    }
  }

  /* ---------- ghi chú chung ---------- */
  if (hdrLines.length && sc !== 'redirect') notes.push('add_header chỉ kế thừa từ cấp trên khi cấp hiện tại KHÔNG có add_header nào. Vì vậy các location có add_header riêng (cache, CORS...) đã được lặp lại header bảo mật.');
  if (useSsl && d.hsts && d.hstsPreload) notes.push('HSTS preload: một khi domain vào danh sách preload của trình duyệt, việc gỡ mất hàng tháng. Chỉ bật khi MỌI subdomain đều chạy HTTPS.');
  if (d.http3) notes.push('HTTP/3: cần nginx >= 1.25 có http_v3_module, mở UDP 443; "reuseport" chỉ khai báo một lần cho mỗi địa chỉ:cổng.');
  if (d.csp !== 'off') notes.push('CSP starter chỉ là điểm khởi đầu: bắt đầu bằng Report-Only, theo dõi lỗi trong console rồi mới chuyển sang enforce. Script/style inline, CDN, font, analytics cần được khai báo thêm.');
  if (d.xfo !== 'off' && d.csp !== 'off') notes.push('X-Frame-Options là cơ chế cũ; CSP frame-ancestors là cơ chế hiện đại và ưu tiên hơn khi cả hai cùng có.');
  if (d.brotli) notes.push('Brotli không có sẵn trong nginx chuẩn: cần cài module ngx_brotli (và load_module trong nginx.conf nếu là module động).');
  if (d.rateLimit) notes.push('limit_req dùng $binary_remote_addr: nếu nginx đứng sau CDN/Load balancer, hãy cấu hình real_ip_header/set_real_ip_from để đếm theo IP thật.');
  if (sc === 'spa') notes.push('try_files $uri $uri/ /index.html: URL không phải file sẽ trả index.html với HTTP 200 (kể cả URL sai). Nếu cần 404 thật cho API/asset, thêm location riêng.');
  if (corsOn && d.corsCredentials) notes.push('CORS + credentials: Access-Control-Allow-Origin phải là origin cụ thể (map ở trên), không bao giờ "*".');

  /* ---------- ghép kết quả ---------- */
  const joinParts = (parts: string[][]) => parts.map((p) => p.join('\n')).join('\n\n');
  const httpText = httpParts.length
    ? ['# ===== Cấp http { } — đặt trong /etc/nginx/conf.d/*.conf (ngoài server) hoặc bên trong http { } của nginx.conf =====', '', joinParts(httpParts)].join('\n') + '\n'
    : '# (Kịch bản này không cần khai báo ở cấp http { })\n';
  const serverText = [...header, `# Đặt file này tại /etc/nginx/sites-available/${certDomain}.conf (symlink sang sites-enabled) hoặc /etc/nginx/conf.d/${certDomain}.conf`, ...(httpParts.length ? ['# CẦN thêm phần cấp http (tab \"Cấp http\") ở nơi khác, hoặc dùng tab \"Gộp 1 file\".'] : []), '', joinParts(servers)].join('\n') + '\n';
  const combined = [...header, '# File gộp: đặt tại /etc/nginx/conf.d/' + certDomain + '.conf (conf.d được include trong http { }).', '', httpParts.length ? joinParts(httpParts) + '\n' : '', joinParts(servers)].join('\n').replace(/\n{3,}/g, '\n\n') + '\n';

  const fullConf = buildFullConf(d, httpParts, servers);
  const commands = buildCommands({ d, certDomain, domains, slug, acmeRoot, authFile, useSsl, crt });

  return { server: serverText, http: httpText, combined, fullConf, commands, warnings, notes, slug, certDomain };
}

function buildFullConf(d: GenOptions, httpParts: string[][], servers: string[][]): string {
  const L: string[] = [];
  L.push('# nginx.conf đầy đủ — tạo bởi GE Tools', '');
  L.push('user www-data;  # Debian/Ubuntu. RHEL/CentOS/Docker: "nginx"');
  L.push('worker_processes auto;');
  L.push('pid /run/nginx.pid;');
  L.push('error_log /var/log/nginx/error.log warn;');
  if (d.brotli) L.push('', '# load_module modules/ngx_http_brotli_filter_module.so;', '# load_module modules/ngx_http_brotli_static_module.so;');
  L.push('');
  L.push(...block('events', ['worker_connections 1024;', '# multi_accept on;']));
  L.push('');
  const http: string[] = [];
  http.push('include /etc/nginx/mime.types;');
  http.push('default_type application/octet-stream;', '');
  http.push('sendfile on;', 'tcp_nopush on;', 'tcp_nodelay on;', 'keepalive_timeout 65;', 'types_hash_max_size 2048;');
  if (d.serverTokensOff) http.push('server_tokens off;');
  http.push('');
  http.push("log_format main '$remote_addr - $remote_user [$time_local] \"$request\" $status $body_bytes_sent \"$http_referer\" \"$http_user_agent\"';");
  http.push('access_log /var/log/nginx/access.log main;', '');
  for (const p of httpParts) http.push(...p, '');
  for (const s of servers) http.push(...s, '');
  while (http.length && http[http.length - 1] === '') http.pop();
  L.push(...block('http', http));
  return L.join('\n') + '\n';
}

function buildCommands(c: { d: GenOptions; certDomain: string; domains: string[]; slug: string; acmeRoot: string; authFile: string; useSsl: boolean; crt: string }): string {
  const { d, certDomain, domains, slug, acmeRoot, authFile } = c;
  const dArgs = domains.filter((x) => x !== '_' && !x.startsWith('*') && !x.startsWith('.')).map((x) => `-d ${x}`).join(' ') || `-d ${certDomain}`;
  const L: string[] = [];
  L.push('# ============ 1. Triển khai trên server (Debian/Ubuntu) ============');
  L.push(`sudo nano /etc/nginx/conf.d/${certDomain}.conf        # dán nội dung tab "Gộp 1 file"`);
  L.push('# hoặc dùng sites-available/sites-enabled:');
  L.push(`# sudo ln -s /etc/nginx/sites-available/${certDomain}.conf /etc/nginx/sites-enabled/`);
  L.push('');
  L.push('sudo nginx -t                  # kiểm tra cú pháp (BẮT BUỘC trước khi reload)');
  L.push('sudo nginx -s reload           # nạp cấu hình mới không gián đoạn');
  L.push('# hoặc: sudo systemctl reload nginx');
  L.push('sudo systemctl enable --now nginx   # bật nginx khi khởi động máy');
  L.push('sudo systemctl status nginx');
  L.push('sudo journalctl -u nginx -e                  # xem log khi nginx không khởi động');
  L.push(`sudo tail -f /var/log/nginx/${slug}.error.log`);
  L.push('');
  if (d.ssl && d.scenario !== 'redirect') {
    L.push("# ============ 2. Chứng chỉ Let's Encrypt (certbot) ============");
    L.push('# Quy trình an toàn: (a) tạo cấu hình KHÔNG bật HTTPS → (b) lấy chứng chỉ → (c) bật HTTPS và reload.');
    L.push('sudo apt install certbot');
    L.push(`sudo mkdir -p ${acmeRoot}`);
    L.push(`sudo certbot certonly --webroot -w ${acmeRoot} ${dArgs}`);
    L.push('# Hoặc để certbot tự sửa cấu hình nginx:  sudo apt install python3-certbot-nginx && sudo certbot --nginx ' + dArgs);
    L.push('sudo certbot renew --dry-run   # kiểm tra gia hạn tự động');
    L.push('# Hook reload sau khi gia hạn:  /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh  →  systemctl reload nginx');
    L.push('');
  }
  if (d.basicAuth) {
    L.push('# ============ 3. Tạo file mật khẩu Basic Auth ============');
    L.push('sudo apt install apache2-utils');
    L.push(`sudo htpasswd -c ${authFile} admin        # lần đầu (-c tạo file); thêm user sau: bỏ -c`);
    L.push('# Không có htpasswd:  printf "admin:$(openssl passwd -apr1)\\n" | sudo tee -a ' + authFile);
    L.push(`sudo chown root:www-data ${authFile} && sudo chmod 640 ${authFile}`);
    L.push('');
  }
  L.push('# ============ Docker ============');
  L.push('docker run -d --name nginx -p 80:80 -p 443:443 \\');
  L.push(`  -v "$PWD/${certDomain}.conf:/etc/nginx/conf.d/default.conf:ro" \\`);
  if (d.ssl) L.push('  -v /etc/letsencrypt:/etc/letsencrypt:ro \\');
  L.push('  nginx:stable');
  L.push('docker exec nginx nginx -t && docker exec nginx nginx -s reload');
  L.push('');
  L.push('# docker-compose.yml');
  L.push('# services:');
  L.push('#   nginx:');
  L.push('#     image: nginx:stable');
  L.push('#     ports: ["80:80", "443:443"]');
  L.push('#     volumes:');
  L.push(`#       - ./${certDomain}.conf:/etc/nginx/conf.d/default.conf:ro`);
  if (d.ssl) L.push('#       - /etc/letsencrypt:/etc/letsencrypt:ro');
  L.push('#     restart: unless-stopped');
  L.push('# Trong container, backend là tên service (vd http://app:3000), không phải 127.0.0.1.');
  L.push('');
  L.push('# ============ systemd: tăng giới hạn file mở khi tải cao ============');
  L.push('sudo systemctl edit nginx   # thêm:  [Service]  LimitNOFILE=65536');
  L.push('# và trong nginx.conf: worker_rlimit_nofile 65536;');
  L.push('');
  L.push('# ============ Kiểm tra sau khi triển khai ============');
  L.push(`curl -I http://${certDomain}/`);
  if (d.ssl) {
    L.push(`curl -I https://${certDomain}/`);
    L.push(`curl -I --resolve ${certDomain}:443:127.0.0.1 https://${certDomain}/   # thử cục bộ không cần DNS`);
    L.push(`openssl s_client -connect ${certDomain}:443 -servername ${certDomain} </dev/null 2>/dev/null | openssl x509 -noout -dates -issuer`);
    L.push(`curl -sI --tlsv1.1 --tls-max 1.1 https://${certDomain}/ || echo "TLS 1.1 bị từ chối (đúng mong đợi)"`);
  }
  if (d.scenario === 'download') L.push(`curl -I -H "Range: bytes=0-99" http://${certDomain}/ten-file.zip   # kỳ vọng 206 Partial Content`);
  if (d.rateLimit) L.push(`for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " ${d.ssl ? 'https' : 'http'}://${certDomain}/; done; echo   # kỳ vọng xuất hiện 429`);
  return L.join('\n') + '\n';
}

/* ---------- giải thích thứ tự ưu tiên location (cho giao diện) ---------- */
export const LOCATION_PRIORITY_NOTES: string[] = [
  '1) location = /path — khớp CHÍNH XÁC toàn bộ URI. Khớp là dùng ngay, không xét gì thêm.',
  '2) Mọi location tiền tố (không modifier hoặc ^~): nginx chọn tiền tố DÀI NHẤT khớp URI.',
  '3) Nếu tiền tố dài nhất có ^~ → dùng luôn, bỏ qua regex.',
  '4) Ngược lại, thử các location regex (~ phân biệt hoa/thường, ~* không phân biệt) THEO THỨ TỰ XUẤT HIỆN trong file; regex đầu tiên khớp thắng.',
  '5) Không regex nào khớp → dùng tiền tố dài nhất đã nhớ ở bước 2.',
  'Hệ quả: thứ tự location tiền tố không quan trọng, nhưng thứ tự location regex RẤT quan trọng.',
];

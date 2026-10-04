/** Public, author-owned descriptions; never applies to user-authored course material. */
export const PUBLIC_METADATA_MESSAGES: Record<string, string> = {
  "Danh tính người dùng": "User identity",
  "JWT xác thực người dùng. Quyền truy cập được kiểm tra theo vai trò, trạng thái tài khoản và ngữ cảnh thao tác.":
    "JWT authenticates users. Access is checked against roles, account status, and the context of each action.",
  "Tin cậy giữa dịch vụ": "Trust between services",
  "Service JWS và Actor Context truyền danh tính đã xác minh giữa các thành phần, thay vì tin vào dữ liệu người dùng tự gửi.":
    "Service JWS and Actor Context carry verified identities between components instead of trusting user-supplied identity data.",
  "Cassandra RBAC và keyspace do từng service sở hữu giới hạn truy cập dữ liệu theo trách nhiệm.":
    "Cassandra RBAC and service-owned keyspaces restrict data access according to each service's responsibilities.",
  "Thông điệp có kiểm soát": "Controlled messaging",
  "RabbitMQ ACL giới hạn quyền broker. Giao nhận at-least-once được phối hợp với idempotency để xử lý giao lại.":
    "RabbitMQ ACL restricts broker permissions. At-least-once delivery is combined with idempotency to handle redelivery.",
  "Học liệu riêng tư": "Private learning materials",
  "MinIO lưu tài liệu riêng tư. Checksum được xác minh trong quy trình xử lý tài liệu.":
    "MinIO stores private documents. Checksums are verified during document processing.",
  "Xử lý secret": "Secret handling",
  "Cấu hình nhạy cảm thuộc môi trường vận hành. Frontend không đóng gói secret dịch vụ, khóa ký hay thông tin kết nối dữ liệu.":
    "Sensitive configuration belongs in the operating environment. The frontend does not bundle service secrets, signing keys, or database connection details.",
  "Khi một node gián đoạn?": "What if a node goes down?",
  "Quan sát tác động lên khả năng phục vụ và phục hồi, với kịch bản dừng/khởi động Cassandra có kiểm soát.":
    "Observe availability and recovery through controlled Cassandra stop/start scenarios.",
  "Khi broker không sẵn sàng?": "What if the broker is unavailable?",
  "Xem cách publisher, consumer và công việc nền phản ứng khi RabbitMQ gián đoạn.":
    "Examine how publishers, consumers, and background jobs respond to a RabbitMQ interruption.",
  "Khi một thông điệp đến hai lần?": "What if a message arrives twice?",
  "Kiểm tra idempotency và ranh giới tác động nghiệp vụ trong giao nhận at-least-once.":
    "Test idempotency and the boundaries of business effects under at-least-once delivery.",
  "Khi projection bị trễ?": "What if a projection is delayed?",
  "Tách tốc độ cập nhật projection khỏi quyết định về tính hợp lệ và quyền nhìn thấy nội dung.":
    "Separate projection update speed from decisions about validity and content visibility.",
  "Khi thông tin xác thực sai?": "What if credentials are invalid?",
  "Quan sát từ chối truy cập, TLS và cơ chế phân quyền thay vì hạ thấp mức xác minh.":
    "Observe access denial, TLS, and authorization without weakening verification.",
  "Bằng chứng nào đủ thuyết phục?": "What evidence is convincing?",
  "Dùng kịch bản, log, metric và kết quả tái lập; không suy ra hiệu năng chỉ từ sơ đồ kiến trúc.":
    "Use scenarios, logs, metrics, and reproducible results; do not infer performance from architecture diagrams alone.",
  "Hiểu dữ liệu trước khi chia sẻ.": "Understand your data before sharing it.",
  "Ghi chú quyền riêng tư cho public web AILSS, mô tả cách bản triển khai này xử lý thông tin.":
    "Privacy notes for the AILSS public website, describing how this implementation handles information.",
  "Phạm vi": "Scope",
  "Public web cung cấp nội dung giới thiệu, tìm kiếm khóa học và biểu mẫu đăng ký/đăng nhập. Đây là thông tin về bản triển khai; chính sách của đơn vị vận hành cần được công bố trước khi cung cấp dịch vụ thực tế.":
    "The public website provides introductory content, course search, and registration/login forms. These notes describe this implementation; the operator's policies must be published before providing a live service.",
  "Dữ liệu gửi đến dịch vụ": "Data sent to services",
  "Tìm kiếm gửi từ khóa đến Course API. Đăng ký gửi tên hiển thị, email và mật khẩu đến Identity API; đăng nhập gửi email và mật khẩu. Không đưa mật khẩu hoặc token vào URL.":
    "Search sends keywords to the Course API. Registration sends a display name, email, and password to the Identity API; login sends email and password. Passwords and tokens are not placed in URLs.",
  "Phiên đăng nhập": "Login sessions",
  "Token được giữ tại máy chủ Web. Trình duyệt nhận cookie phiên HttpOnly; không lưu token vào localStorage hoặc sessionStorage. Tải lại trang sẽ xác minh lại hồ sơ. Khởi động lại máy chủ Web làm mất phiên Web; nút đăng xuất yêu cầu thu hồi phiên Identity hiện tại.":
    "Tokens are kept on the Web server. The browser receives an HttpOnly session cookie; tokens are not stored in localStorage or sessionStorage. Reloading revalidates the profile. Restarting the Web server loses Web sessions; signing out requests revocation of the current Identity session.",
  "Liên hệ & minh họa": "Contact & demonstrations",
  "Biểu mẫu liên hệ chỉ tạo tệp bản nháp trên thiết bị, không gửi lên máy chủ. Demo AI và số liệu tiến độ là dữ liệu minh họa cục bộ.":
    "The contact form only creates a draft file on your device and does not send it to a server. The AI demo and progress figures are local illustrative data.",
  "Theo dõi & bên thứ ba": "Tracking & third parties",
  "Public web không tích hợp analytics hoặc quảng cáo. Ảnh, video và nhận diện được phục vụ nội bộ. Tài liệu học tập trong backend dùng lưu trữ riêng tư; việc dùng nhà cung cấp AI phụ thuộc cấu hình triển khai.":
    "The public website does not integrate analytics or advertising. Images, videos, and branding are served internally. Backend learning materials use private storage; AI provider usage depends on deployment configuration.",
  "Lưu giữ & yêu cầu dữ liệu": "Retention & data requests",
  "Thời hạn lưu giữ, thông tin đơn vị vận hành và đầu mối xử lý yêu cầu dữ liệu chưa được cấu hình trên public web. Người dùng cần liên hệ quản trị của đơn vị triển khai để có chính sách áp dụng.":
    "Retention periods, operator details, and data-request contacts are not configured on the public website. Users should contact their deployment administrator for applicable policies.",
  "Một không gian học tập có trách nhiệm.": "A responsible learning space.",
  "Thông tin sử dụng public web và phạm vi chức năng của bản triển khai hiện tại.":
    "Information about using the public website and the functionality of the current implementation.",
  "Nội dung công khai": "Public content",
  "Bạn có thể xem trang giới thiệu và thông tin khóa học đã xuất bản. Không phải mọi khả năng backend đều đã có màn hình thao tác sau đăng nhập.":
    "You can view introductory pages and published course information. Not every backend capability has a corresponding screen after login.",
  "Đăng ký công khai tạo tài khoản sinh viên. Bảo vệ thông tin đăng nhập và chỉ sử dụng tài khoản bạn được quyền truy cập.":
    "Public registration creates student accounts. Protect your credentials and only use accounts you are authorized to access.",
  "Học liệu & quyền sử dụng": "Learning materials & usage rights",
  "Chỉ tải hoặc chia sẻ tài liệu bạn có quyền sử dụng. Không dùng nội dung của người khác khi chưa có quyền phù hợp.":
    "Only upload or share materials you have permission to use. Do not use other people's content without appropriate rights.",
  "AI & quyết định chuyên môn": "AI & professional decisions",
  "AI có thể tạo nội dung không chính xác. Giảng viên cần rà soát, chỉnh sửa và phê duyệt; AI không tự xuất bản bài đánh giá.":
    "AI may generate inaccurate content. Lecturers must review, edit, and approve it; AI does not publish assessments automatically.",
  "Hành vi trong cộng đồng": "Community conduct",
  "Trao đổi có tôn trọng. Không chia sẻ thông tin đăng nhập, dữ liệu riêng tư của người khác hoặc nội dung gây hại. Sử dụng quy trình báo cáo khi có vấn đề.":
    "Communicate respectfully. Do not share credentials, other people's private data, or harmful content. Use the reporting process when an issue arises.",
  "Phạm vi triển khai": "Deployment scope",
  "Thông tin pháp nhân vận hành, điều khoản thương mại và điều kiện cung cấp dịch vụ chưa được xác định trên trang này. Đây chưa phải bộ điều khoản vận hành hoàn chỉnh cho dịch vụ thương mại.":
    "Operator legal details, commercial terms, and service conditions are not defined on this page. These are not yet complete operating terms for a commercial service.",
  "Ít lưu trữ hơn. Minh bạch hơn.": "Less storage. More transparency.",
  "Public web hiện không đặt cookie theo dõi và không dùng công cụ quảng cáo hoặc analytics.":
    "The public website currently sets no tracking cookies and uses no advertising or analytics tools.",
  "Cookie của frontend": "Frontend cookies",
  "Sau đăng nhập, máy chủ đặt cookie phiên thiết yếu HttpOnly, SameSite=Lax và Secure khi triển khai HTTPS. Cookie dùng để duy trì đăng nhập, không phục vụ quảng cáo.":
    "After login, the server sets an essential HttpOnly, SameSite=Lax session cookie, with Secure on HTTPS deployments. It maintains login and is not used for advertising.",
  "Thông tin xác thực": "Credentials",
  "Cookie chỉ chứa mã phiên ngẫu nhiên. Access token và refresh token ở phía máy chủ, không được trả cho JavaScript của trang. Không lưu token vào localStorage, sessionStorage hay IndexedDB.":
    "The cookie contains only a random session ID. Access and refresh tokens remain server-side and are not returned to page JavaScript. Tokens are not stored in localStorage, sessionStorage, or IndexedDB.",
  "Tùy chọn trình duyệt": "Browser preferences",
  "Bạn có thể dùng cài đặt trình duyệt để quản lý cookie. Cấu hình reverse proxy hoặc đơn vị vận hành có thể thay đổi hành vi; cần cập nhật trang này khi triển khai thêm công cụ.":
    "You can manage cookies in browser settings. Reverse-proxy configuration or operator choices may change behavior; this page should be updated when additional tools are deployed.",
  "Việc học nên mở ra với nhiều người hơn.": "Learning should be open to more people.",
  "AILSS hướng tới trải nghiệm có thể sử dụng bằng bàn phím, màn hình nhỏ và tùy chọn giảm chuyển động.":
    "AILSS aims to support keyboard navigation, small screens, and reduced-motion preferences.",
  "Có skip link đến nội dung chính, focus hiển thị, cấu trúc heading và landmarks. Menu di động và lightbox dùng dialog để quản lý focus và đóng bằng Escape.":
    "A skip link leads to the main content, with visible focus, structured headings, and landmarks. Mobile menus and lightboxes use dialogs to manage focus and close with Escape.",
  "Chuyển động & 3D": "Motion & 3D",
  "Tôn trọng prefers-reduced-motion. Nội dung vẫn có văn bản và ảnh poster khi WebGL không có hoặc màn hình nhỏ. Chuyển động không truyền đạt thông tin duy nhất.":
    "The interface respects prefers-reduced-motion. Text and poster images remain available without WebGL or on small screens. Motion is not the sole means of conveying information.",
  "Hình ảnh & video": "Images & video",
  "Ảnh có mô tả và kích thước xác định. Video có điều khiển, phụ đề tiếng Việt và bản mô tả bằng văn bản, không tự phát âm thanh.":
    "Images have descriptions and defined dimensions. Videos have controls, Vietnamese captions, and written descriptions; audio does not autoplay.",
  "Biểu mẫu": "Forms",
  "Input có nhãn; trạng thái và lỗi được thông báo bằng vùng live. Không chỉ dùng màu để diễn đạt trạng thái.":
    "Inputs have labels; status and errors are announced through live regions. Color is not the only way to communicate status.",
  "Cải tiến liên tục": "Continuous improvement",
  "Kiểm thử tự động và kiểm tra bàn phím là nền tảng, không thay thế thử nghiệm với mọi công nghệ hỗ trợ. Chưa tuyên bố chứng nhận tuân thủ. Có thể chuẩn bị phản hồi tại trang liên hệ.":
    "Automated tests and keyboard checks are a foundation, not a substitute for testing all assistive technologies. No compliance certification is claimed. Feedback can be prepared on the contact page.",
  "Cấp độ 1": "Level 1",
  "Cấp độ 2": "Level 2",
  "Cấp độ 3": "Level 3",
  "Cấp độ 4": "Level 4",
  "Cấp độ 5": "Level 5",
  "Cấp độ 6": "Level 6",
  "Liệt kê, Định nghĩa, Tái hiện, Nhận diện": "List, Define, Recall, Identify",
  "Tái hiện chính xác định nghĩa và thuật ngữ cốt lõi từ học liệu":
    "Accurately recall core definitions and terminology from learning materials",
  "Thuật toán nào được sử dụng để phân phối thông điệp trong cụm Kafka Broker?":
    "Which algorithm distributes messages in a Kafka broker cluster?",
  "Kiểm tra khả năng ghi nhớ tên giao thức và thuật toán mà không yêu cầu suy luận phức tạp.":
    "Test recall of protocol and algorithm names without requiring complex reasoning.",
  "Giải thích, Tóm tắt, Phân biệt, Diễn giải": "Explain, Summarize, Distinguish, Interpret",
  "Diễn giải nguyên lý vận hành và nguyên nhân gốc rễ bằng ngôn ngữ học thuật":
    "Explain operating principles and root causes in academic language",
  "Vì sao Consumer Group trong Kafka cần cơ chế Partition Rebalance khi có một node gặp sự cố?":
    "Why does a Kafka consumer group need partition rebalancing when a node fails?",
  "Đánh giá mức độ thấu hiểu cơ chế phân phối tải và tính sẵn sàng cao (High Availability).":
    "Assess understanding of load distribution and high availability.",
  "Áp dụng, Tính toán, Triển khai, Viết mã": "Apply, Calculate, Implement, Code",
  "Áp dụng công thức, quy tắc hoặc mẫu thiết kế vào bài toán thực tế":
    "Apply formulas, rules, or design patterns to practical problems",
  "Triển khai mẫu Idempotent Consumer với Redis Deduplication Key để ngăn giao dịch bị nhân đôi.":
    "Implement an idempotent consumer with a Redis deduplication key to prevent duplicate transactions.",
  "Yêu cầu người học vận dụng kiến thức lý thuyết vào mã nguồn và cấu hình kiến trúc cụ thể.":
    "Require learners to apply theoretical knowledge to concrete code and architecture configuration.",
  "Phân tích": "Analyze",
  "Phân rã, So sánh, Định vị lỗi, Đánh đổi": "Decompose, Compare, Diagnose, Evaluate trade-offs",
  "Phân tích cấu trúc dữ liệu, so sánh ưu nhược điểm kiến trúc và đo lường trade-offs":
    "Analyze data structures, compare architectural strengths and weaknesses, and measure trade-offs",
  "So sánh hiệu năng giữa B-Tree Composite Index (A, B) và hai Single Index riêng lẻ khi câu truy vấn lọc theo cả hai trường.":
    "Compare the performance of a composite B-tree index (A, B) with two separate indexes when a query filters on both fields.",
  "Rèn luyện tư duy phân tích sâu về cơ chế Index Scan vs Bitmap Index Scan trong PostgreSQL.":
    "Develop deeper analysis of Index Scan versus Bitmap Index Scan in PostgreSQL.",
  "Thẩm định, Phê bình, Đo lường, Bảo mật": "Appraise, Critique, Measure, Secure",
  "Đánh giá rủi ro hệ thống, thẩm định phương án kỹ thuật và kiểm thử biên an toàn":
    "Assess system risks, appraise technical options, and test safety boundaries",
  "Đánh giá mức độ ảnh hưởng đến SLA và tính toàn vẹn dữ liệu khi hạ Replication Factor từ 3 xuống 1 để tiết kiệm chi phí.":
    "Evaluate the impact on SLA and data integrity when reducing the replication factor from 3 to 1 to save costs.",
  "Thử thách năng lực ra quyết định kỹ thuật cấp kiến trúc sư với nhận thức rủi ro đầy đủ.":
    "Challenge architect-level technical decision-making with full awareness of risk.",
  "Sáng tạo": "Create",
  "Thiết kế, Tích hợp, Quy hoạch, Tối ưu": "Design, Integrate, Plan, Optimize",
  "Thiết kế giải pháp toàn diện kết hợp nhiều công nghệ giải quyết bài toán phức tạp":
    "Design comprehensive solutions combining technologies to solve complex problems",
  "Thiết kế kiến trúc hệ thống E-commerce chịu tải 100,000 req/s kết hợp CDC (Debezium), Kafka và Elasticsearch.":
    "Design an e-commerce architecture supporting 100,000 requests/s with CDC (Debezium), Kafka, and Elasticsearch.",
  "Đỉnh cao của thang Bloom: tổng hợp kiến thức để xây dựng đồ án kỹ thuật hoàn chỉnh.":
    "The highest Bloom level: synthesize knowledge to build a complete technical project.",
  "Giáo trình và bài giảng scan OCR chất lượng cao": "High-quality OCR for scanned textbooks and lectures",
  "Đề cương, giáo án Word phân tách tự động theo mục lục":
    "Word syllabi and lesson plans automatically divided by their contents",
  "Tài liệu kỹ thuật, ghi chú mã nguồn định dạng chuẩn":
    "Technical documentation and consistently formatted code notes",
  "Truy hồi ngữ nghĩa riêng tư, không lộ học liệu":
    "Private semantic retrieval without exposing learning materials",
  "Lập chỉ mục HNSW vector cosine dưới 15ms": "HNSW cosine-vector indexing under 15ms",
  "Chuẩn hóa 6 bậc thang nhận thức sư phạm": "Standardize six pedagogical cognitive levels",
  "Danh tính và quyền truy cập": "Identity and access",
  "Tài khoản, phiên đăng nhập, vai trò và xác minh giảng viên tạo ranh giới cho mỗi thao tác.":
    "Accounts, login sessions, roles, and lecturer verification define the boundaries of every action.",
  "Đăng nhập → Kiểm tra quyền → Truy cập": "Log in → Check permissions → Access",
  "Tổ chức tri thức": "Organize knowledge",
  "Khóa học đi qua biên soạn, gửi duyệt và xuất bản; danh mục chỉ hiển thị nội dung công khai.":
    "Courses go through authoring, review submission, and publication; the catalog displays only public content.",
  "Soạn nội dung → Rà soát → Xuất bản": "Author content → Review → Publish",
  "Đợt mở khóa học": "Course offerings",
  "Offering liên kết khóa học với bối cảnh triển khai; điều kiện tham gia được kiểm tra theo quyền.":
    "Offerings connect courses to their delivery context; participation requirements are checked against permissions.",
  "Khóa học → Offering → Lớp học": "Course → Offering → Class",
  "Tham gia có kiểm soát": "Controlled participation",
  "Đăng ký học và quyền truy cập nội dung được quản lý riêng, giúp bảo vệ học liệu.":
    "Enrollment and content access are managed separately to protect learning materials.",
  "Khám phá → Đăng ký → Kiểm tra quyền": "Explore → Enroll → Check permissions",
  "Kết nối lớp học": "Connect the classroom",
  "Quản lý thành viên, mã tham gia, lịch, phiên học và điểm danh.":
    "Manage members, join codes, schedules, sessions, and attendance.",
  "Thành viên → Phiên học → Điểm danh": "Members → Sessions → Attendance",
  "Theo dõi từng bài học": "Track every lesson",
  "Trạng thái hoàn thành bài học tạo nên tiến độ khóa học của từng sinh viên.":
    "Lesson completion builds each student's course progress.",
  "Bài học → Hoàn thành → Tiến độ": "Lesson → Completion → Progress",
  "Đánh giá khách quan": "Objective assessment",
  "Quiz, lượt làm, nộp bài và kết quả được tổ chức thành quy trình đánh giá.":
    "Quizzes, attempts, submissions, and results form an assessment workflow.",
  "Quiz → Attempt → Kết quả": "Quiz → Attempt → Results",
  "Không gian trao đổi": "Discussion space",
  "Bình luận giúp trao đổi trong ngữ cảnh học tập; nội dung được bảo vệ bằng quyền truy cập.":
    "Comments support discussion in a learning context; content is protected by access permissions.",
  "Đọc → Bình luận → Phản hồi": "Read → Comment → Respond",
  "Phản hồi trải nghiệm": "Experience feedback",
  "Người học đủ điều kiện có thể để lại đánh giá khóa học theo quy tắc của hệ thống.":
    "Eligible learners can review courses under the system's rules.",
  "Trải nghiệm → Đánh giá → Rà soát": "Experience → Review → Check",
  "Chăm sóc không gian chung": "Care for shared spaces",
  "Báo cáo và kiểm duyệt hỗ trợ xử lý nội dung không phù hợp.":
    "Reporting and moderation help address inappropriate content.",
  "Báo cáo → Kiểm tra → Xử lý": "Report → Check → Resolve",
  "Học liệu sẵn sàng cho AI": "AI-ready learning materials",
  "PDF, DOCX và TXT được xác minh và trích xuất trong quy trình riêng tư.":
    "PDF, DOCX, and TXT documents are verified and extracted through a private workflow.",
  "Tải lên → Checksum → Trích xuất": "Upload → Checksum → Extract",
  "Từ học liệu đến câu hỏi": "From materials to questions",
  "AI tạo bản nháp câu hỏi khách quan theo cấu trúc định dạng rõ ràng.":
    "AI drafts objective questions in a clearly defined format.",
  "Trích xuất → AI → Bản nháp": "Extract → AI → Draft",
  "Giảng viên quyết định": "Lecturers decide",
  "Giảng viên rà soát và phê duyệt trước khi chuyển sang bài đánh giá nháp.":
    "Lecturers review and approve before moving content into a draft assessment.",
  "Rà soát → Phê duyệt → Biên tập": "Review → Approve → Edit",
  "Không bỏ lỡ cập nhật": "Never miss an update",
  "Thông báo trong ứng dụng có trạng thái chưa đọc và đã đọc.":
    "In-app notifications have unread and read states.",
  "Đăng ký tham gia": "Enroll",
  "Học theo bài": "Learn lesson by lesson",
  "Theo dõi tiến độ": "Track progress",
  "Làm bài đánh giá": "Take assessments",
  "Trao đổi & phản hồi": "Discuss & respond",
  "Nhận thông báo": "Receive notifications",
  "Biên soạn khóa học": "Author courses",
  "Gửi duyệt & xuất bản": "Submit for review & publish",
  "Quản lý lớp học": "Manage classes",
  "Rà soát & phê duyệt": "Review & approve",
  "Chuyển sang đánh giá": "Move to assessment",
  "Chủ động hơn trong mỗi bước học.": "Take charge of every learning step.",
  "Khám phá, tham gia, học tập và nhìn lại tiến độ — trong một hành trình có tổ chức.":
    "Explore, join, learn, and reflect on progress in an organized journey.",
  "Từ sự tò mò đến hiểu biết.": "From curiosity to understanding.",
  "Tra cứu tên khóa học đã xuất bản và xem thông tin công khai trước khi tham gia.":
    "Search published course titles and view public information before joining.",
  "Học cùng lớp": "Learn with your class",
  "Tham gia đúng lớp, theo dõi lịch và các phiên học được tổ chức.":
    "Join the right class and follow its schedule and organized sessions.",
  "Biết mình đang ở đâu": "Know where you stand",
  "Đánh dấu hoàn thành bài học và theo dõi tiến độ theo khóa học.":
    "Mark lessons complete and track progress by course.",
  "Học từ kết quả": "Learn from results",
  "Làm quiz và xem kết quả chấm khách quan của lượt làm bài.":
    "Take quizzes and view objective grading results for each attempt.",
  "Giữ cuộc trao đổi tiếp tục": "Keep the discussion going",
  "Bình luận, phản hồi và review khi đáp ứng điều kiện.": "Comment, respond, and review when eligible.",
  "Theo dõi cập nhật": "Follow updates",
  "Nhận thông báo trong ứng dụng và đánh dấu đã đọc.": "Receive in-app notifications and mark them read.",
  "Tập trung vào điều bạn muốn truyền đạt.": "Focus on what you want to teach.",
  "Từ biên soạn bài học đến tổ chức lớp và duyệt bản nháp AI, giảng viên luôn giữ vai trò quyết định.":
    "From authoring lessons to organizing classes and reviewing AI drafts, lecturers stay in control.",
  "Một quy trình dạy học có kiểm soát.": "A controlled teaching workflow.",
  "Biên soạn & xuất bản": "Author & publish",
  "Tạo khóa học, tổ chức bài học, gửi duyệt và theo dõi trạng thái xuất bản.":
    "Create courses, organize lessons, submit for review, and track publication status.",
  "Tổ chức lớp học": "Organize classes",
  "Chuẩn bị quiz": "Prepare quizzes",
  "Biên soạn câu hỏi khách quan và quản lý bài đánh giá.":
    "Author objective questions and manage assessments.",
  "AI hỗ trợ từ tài liệu": "Document-based AI assistance",
  "Tải tài liệu riêng tư, trích xuất và yêu cầu bản nháp câu hỏi.":
    "Upload private documents, extract them, and request question drafts.",
  "Kiểm tra đáp án, chỉnh sửa câu hỏi và chuyển bản đã duyệt sang bài đánh giá nháp.":
    "Check answers, edit questions, and move approved content into draft assessments.",
  "Nhìn lại kết quả": "Reflect on results",
  "Xem kết quả làm bài để hỗ trợ trao đổi về kiến thức với người học.":
    "View assessment results to support discussions about learners' knowledge.",
  "Một nơi để việc học diễn ra cùng nhau.": "A place to learn together.",
  "Lớp học kết nối con người, thời gian và hoạt động học tập trong một bối cảnh rõ ràng.":
    "Classes connect people, time, and learning activities in a clear context.",
  "Tổ chức lớp, từ thành viên đến phiên học.": "Organize classes, from members to sessions.",
  "Thành viên & mã tham gia": "Members & join codes",
  "Quản lý ai thuộc lớp và dùng mã tham gia theo điều kiện của hệ thống.":
    "Manage class membership and use join codes under the system's requirements.",
  "Lịch & phiên học": "Schedules & sessions",
  "Sắp xếp lịch và các buổi học, giúp thành viên biết khi nào cần tham gia.":
    "Arrange schedules and sessions so members know when to join.",
  "Theo dõi tham gia và xử lý điểm danh theo quy trình được giảng viên quản lý.":
    "Track participation and handle attendance through lecturer-managed workflows.",
  "Cập nhật thông tin lớp qua thông báo trong ứng dụng.": "Share class updates through in-app notifications.",
  "Đánh giá để hiểu việc học rõ hơn.": "Assess to better understand learning.",
  "Từ câu hỏi đến lượt làm bài, AILSS tổ chức quá trình đánh giá khách quan và kết quả.":
    "From questions to attempts, AILSS organizes objective assessment and results.",
  "Mỗi lượt làm bài có một hành trình.": "Every attempt has a journey.",
  "Quiz có cấu trúc": "Structured quizzes",
  "Chuẩn bị câu hỏi, lựa chọn và đáp án trong bài đánh giá.":
    "Prepare questions, options, and answers in assessments.",
  "Lượt làm bài": "Attempts",
  "Sinh viên bắt đầu và thực hiện lượt làm bài trong phạm vi được phép.":
    "Students start and complete attempts within their authorized scope.",
  "Nộp & chấm khách quan": "Submit & grade objectively",
  "Hệ thống xử lý bài nộp theo quy tắc chấm điểm khách quan đã triển khai.":
    "The system processes submissions using its implemented objective grading rules.",
  "Kết quả để xem lại": "Results to revisit",
  "Kết quả gắn với lượt làm bài; hỗ trợ người học nhìn lại kiến thức.":
    "Results are linked to attempts and help learners revisit their knowledge.",
  "Nhìn thấy hành trình bạn đã đi.": "See the journey you've taken.",
  "Theo dõi bài học hoàn thành và tiến độ khóa học để tiếp tục việc học có chủ đích.":
    "Track completed lessons and course progress to continue learning with purpose.",
  "Từng bài học đều có ý nghĩa.": "Every lesson matters.",
  "Trạng thái hoàn thành ghi nhận bước tiến của người học theo bài học.":
    "Completion status records learners' progress lesson by lesson.",
  "Tổng quan khóa học": "Course overview",
  "Tiến độ tổng hợp giúp nhìn lại phần đã học và phần còn lại.":
    "Aggregate progress shows what you have learned and what remains.",
  "Đúng người, đúng nội dung": "The right people, the right content",
  "Dữ liệu tiến độ gắn với người học và quyền truy cập khóa học.":
    "Progress data is linked to learners and course access permissions.",
  "Giữ kết nối với những cập nhật cần thiết.": "Stay connected to essential updates.",
  "Thông báo trong ứng dụng giúp theo dõi thông tin lớp học và trạng thái đã đọc.":
    "In-app notifications help track class updates and read status.",
  "Đọc, ghi nhận và tiếp tục.": "Read, acknowledge, and continue.",
  "Thông tin được trình bày trong ngữ cảnh tài khoản người dùng.":
    "Information is presented in the context of each user's account.",
  "Chưa đọc → Đã đọc": "Unread → Read",
  "Trạng thái UNREAD và READ phân biệt những cập nhật bạn đã xem.":
    "UNREAD and READ distinguish updates you have viewed.",
  "Câu chuyện lớp học": "Classroom updates",
  "Một thông báo lớp đưa cập nhật đến thành viên theo quyền và phạm vi phù hợp.":
    "A class announcement delivers updates to members under the appropriate permissions and scope.",
  "Danh tính & quyền truy cập": "Identity & access",
  "Tài khoản, phiên đăng nhập, vai trò và xác minh giảng viên.":
    "Accounts, login sessions, roles, and lecturer verification.",
  "Khóa học & hành trình": "Courses & journeys",
  "Nội dung khóa học, bài học, enrollment, entitlement và tiến độ.":
    "Course content, lessons, enrollment, entitlement, and progress.",
  "Không gian lớp học": "Classroom space",
  "Thành viên, mã tham gia, lịch, phiên học và điểm danh.":
    "Members, join codes, schedules, sessions, and attendance.",
  "Đánh giá & kết quả": "Assessments & results",
  "Quiz, lượt làm bài, chấm điểm khách quan và kết quả.":
    "Quizzes, attempts, objective grading, and results.",
  "Bình luận, đánh giá, báo cáo nội dung và kiểm duyệt.":
    "Comments, reviews, content reports, and moderation.",
  "Tài liệu & bản nháp": "Documents & drafts",
  "Xử lý tài liệu, tạo quiz theo objective-v1 và phê duyệt bởi giảng viên.":
    "Document processing, objective-v1 quiz generation, and lecturer approval.",
  "6 dịch vụ nghiệp vụ": "6 business services",
  "Đoạn chat chưa đặt tên": "Untitled conversation",
  "Đoạn 1 · Tổng quan": "Chunk 1 · Overview",
  "Đoạn 2 · Idempotency": "Chunk 2 · Idempotency",
  "Đoạn 3 · Giám sát DLQ": "Chunk 3 · DLQ monitoring",
  "Kiến trúc Phân tán & Message Queue": "Distributed Architecture & Message Queues",
  "Cơ sở Dữ liệu & Tối ưu hóa Index": "Databases & Index Optimization",
  "Trí tuệ Nhân tạo & Kỹ thuật RAG": "Artificial Intelligence & RAG Techniques",
  "Bloom Level 3: Vận dụng (Application)": "Bloom Level 3: Apply (Application)",
  "Bloom Level 4: Phân tích (Analysis)": "Bloom Level 4: Analyze (Analysis)",
  "Bloom Level 2: Thông hiểu (Comprehension)": "Bloom Level 2: Understand (Comprehension)",
  "Trung bình · 1 điểm": "Intermediate · 1 point",
  "Nâng cao · 1.5 điểm": "Advanced · 1.5 points",
  "Cơ bản · 1 điểm": "Basic · 1 point",
  "Đã gửi cảnh báo đến {0}.": "Warning sent to {0}.",
  "Đã gửi cảnh báo cho {0}.": "Warning sent to {0}.",
  "Đã xóa {0} khỏi lớp.": "Removed {0} from the class.",
  "Đã lưu phiên bản v{0}.": "Saved version v{0}.",
  "Đã xuất bản phiên bản v{0}.": "Published version v{0}.",
  "Nhập điểm từ 0 đến {0}.": "Enter a score between 0 and {0}.",
  "✓ Đã cập nhật trạng thái {0} cho học viên.": "✓ Updated the student's status to {0}.",
  "Đã lưu thành công phiên bản v{0}!": "Successfully saved version v{0}!",
  "Đã áp dụng chiết khấu {0}% cho đơn mới.": "Applied a {0}% commission to new orders.",
  "Đã lập phiếu kỳ {0}. Cần chuyển khoản và đối chiếu riêng.{1}":
    "Prepared payout instructions for {0}. Transfers and reconciliation must be performed separately.{1}",
  " {0} người chưa đủ điều kiện.": " {0} people are not yet eligible.",
  "{0} Câu hỏi đã được giữ lại để bạn thử lại.": "{0} Your question has been preserved so you can retry.",
  "{0} Vui lòng kiểm tra lại kết nối hoặc thử gửi lại câu hỏi.":
    "{0} Please check your connection or try sending the question again.",
  "{0}: cần {1}–{2} ký tự.": "{0}: requires {1}–{2} characters.",
};

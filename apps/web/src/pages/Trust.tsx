import { useUiText } from "../lib/i18n";
import { useLocation } from "react-router-dom";
import { PageHero, Section, TextLink } from "../components/ui";
export function Security() {
  const uiText = useUiText();
  const items = [
    [
      "Danh tính người dùng",
      "JWT xác thực người dùng. Quyền truy cập được kiểm tra theo vai trò, trạng thái tài khoản và ngữ cảnh thao tác.",
    ],
    [
      "Tin cậy giữa dịch vụ",
      "Service JWS và Actor Context truyền danh tính đã xác minh giữa các thành phần, thay vì tin vào dữ liệu người dùng tự gửi.",
    ],
    [
      "Ranh giới dữ liệu",
      "Cassandra RBAC và keyspace do từng service sở hữu giới hạn truy cập dữ liệu theo trách nhiệm.",
    ],
    [
      "Thông điệp có kiểm soát",
      "RabbitMQ ACL giới hạn quyền broker. Giao nhận at-least-once được phối hợp với idempotency để xử lý giao lại.",
    ],
    [
      "Học liệu riêng tư",
      "MinIO lưu tài liệu riêng tư. Checksum được xác minh trong quy trình xử lý tài liệu.",
    ],
    [
      "Xử lý secret",
      "Cấu hình nhạy cảm thuộc môi trường vận hành. Frontend không đóng gói secret dịch vụ, khóa ký hay thông tin kết nối dữ liệu.",
    ],
  ];
  return (
    <>
      <PageHero
        label="SECURITY"
        title={uiText("Niềm tin được xây từ những ranh giới rõ ràng.")}
        description={uiText(
          "Những cơ chế bảo vệ đã được triển khai trong AILSS, trình bày minh bạch cùng phạm vi của chúng.",
        )}
      />
      <Section>
        <div className="security-intro">
          <h2>
            {uiText("Bảo vệ người dùng.")}
            <br />
            {uiText("Giữ học liệu riêng tư.")}
          </h2>
          <p className="lead">
            {uiText(
              "Mỗi yêu cầu cần đúng danh tính, đúng quyền và đúng bối cảnh. Bảo mật được xem xét từ lối vào hệ thống đến dữ liệu và công việc nền.",
            )}
          </p>
        </div>
        <div className="help-grid">
          {items.map(([title, body]) => (
            <article key={title}>
              <h2>{uiText(title)}</h2>
              <p>{uiText(body)}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section className="soft">
        <div className="split">
          <div>
            <h2>{uiText("Cam kết về sự minh bạch.")}</h2>
            <p>
              {uiText(
                "Trang này mô tả thiết kế và cơ chế của dự án. Không tuyên bố có SOC 2, ISO, HIPAA, PCI hoặc chứng nhận kiểm thử xâm nhập.",
              )}
            </p>
          </div>
          <div>
            <h3>{uiText("Báo cáo vấn đề")}</h3>
            <p>
              {uiText(
                "Nếu phát hiện vấn đề, hãy ghi lại bước tái hiện không chứa secret hoặc dữ liệu cá nhân và dùng kênh quản trị được đơn vị triển khai cung cấp.",
              )}
            </p>
            <TextLink to="/contact">{uiText("Chuẩn bị nội dung liên hệ")}</TextLink>
            <TextLink to="/architecture">{uiText("Xem kiến trúc hệ thống")}</TextLink>
          </div>
        </div>
      </Section>
    </>
  );
}
export function Research() {
  const uiText = useUiText();
  return (
    <>
      <PageHero
        label="RESEARCH / DISTRIBUTED SYSTEMS"
        title={uiText("Hiểu hệ thống bằng cách đặt câu hỏi khó.")}
        description={uiText(
          "AILSS là bối cảnh nghiên cứu cho Cassandra-first, dịch vụ phân tán và luồng xử lý bất đồng bộ có thể quan sát.",
        )}
      />
      <Section>
        <div className="split">
          <div>
            <p className="eyebrow">CASSANDRA-FIRST</p>
            <h2>
              {uiText("Bắt đầu từ truy vấn.")}
              <br />
              {uiText("Thiết kế cách lưu.")}
            </h2>
          </div>
          <div>
            <p className="lead">
              {uiText(
                "Mỗi truy vấn nghiệp vụ có mục đích xác định. Mô hình dữ liệu phục vụ đường đọc cụ thể thay vì trông chờ vào join hoặc tìm kiếm tùy ý.",
              )}
            </p>
            <p>
              {uiText(
                "Service sở hữu keyspace của mình; projection hỗ trợ truy cập theo nhu cầu và được kiểm tra với dữ liệu canonical khi cần.",
              )}
            </p>
          </div>
        </div>
      </Section>
      <Section className="soft">
        <div className="section-heading">
          <h2>{uiText("Những câu hỏi dẫn đường.")}</h2>
        </div>
        <div className="help-grid">
          {[
            [
              "Khi một node gián đoạn?",
              "Quan sát tác động lên khả năng phục vụ và phục hồi, với kịch bản dừng/khởi động Cassandra có kiểm soát.",
            ],
            [
              "Khi broker không sẵn sàng?",
              "Xem cách publisher, consumer và công việc nền phản ứng khi RabbitMQ gián đoạn.",
            ],
            [
              "Khi một thông điệp đến hai lần?",
              "Kiểm tra idempotency và ranh giới tác động nghiệp vụ trong giao nhận at-least-once.",
            ],
            [
              "Khi projection bị trễ?",
              "Tách tốc độ cập nhật projection khỏi quyết định về tính hợp lệ và quyền nhìn thấy nội dung.",
            ],
            [
              "Khi thông tin xác thực sai?",
              "Quan sát từ chối truy cập, TLS và cơ chế phân quyền thay vì hạ thấp mức xác minh.",
            ],
            [
              "Bằng chứng nào đủ thuyết phục?",
              "Dùng kịch bản, log, metric và kết quả tái lập; không suy ra hiệu năng chỉ từ sơ đồ kiến trúc.",
            ],
          ].map(([title, body]) => (
            <article key={title}>
              <h2>{uiText(title)}</h2>
              <p>{uiText(body)}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section>
        <h2>{uiText("Phạm vi của trang nghiên cứu")}</h2>
        <p className="measure">
          {uiText(
            "Trang này giới thiệu phương pháp và các kịch bản nghiên cứu trong repository. Không công bố benchmark, SLA hay kết luận khả năng mở rộng khi chưa gắn với môi trường và phép đo cụ thể.",
          )}
        </p>
        <div className="actions">
          <TextLink to="/architecture">{uiText("Khám phá sáu service")}</TextLink>
          <TextLink to="/contact">{uiText("Trao đổi nghiên cứu")}</TextLink>
        </div>
      </Section>
    </>
  );
}
export function Roadmap() {
  const uiText = useUiText();
  return (
    <>
      <PageHero
        label="PRODUCT ROADMAP"
        title={uiText("Nền tảng hôm nay. Trải nghiệm ngày mai.")}
        description={uiText(
          "Phân biệt rõ khả năng backend đã triển khai, công việc public web hiện tại và hướng phát triển tiếp theo.",
        )}
      />
      <Section>
        <ol className="roadmap">
          <li>
            <span className="status-tag">{uiText("Đã triển khai · Backend")}</span>
            <h2>Phase 7–9</h2>
            <p>
              {uiText(
                "Danh tính, khóa học, lớp học, lịch, enrollment và entitlement. Tiếp nối bởi đánh giá, tiến độ, tương tác, review và kiểm duyệt.",
              )}
            </p>
          </li>
          <li>
            <span className="status-tag">{uiText("Đã triển khai · Backend")}</span>
            <h2>Phase 10–11</h2>
            <p>
              {uiText(
                "Xử lý tài liệu, AI tạo câu hỏi, giảng viên phê duyệt và nhập Assessment DRAFT. Thông báo trong ứng dụng được bổ sung bằng worker hỗ trợ.",
              )}
            </p>
          </li>
          <li>
            <span className="status-tag">{uiText("Giai đoạn hiện tại")}</span>
            <h2>Phase 12.1 · Public experience</h2>
            <p>
              {uiText("Web foundation, NVD branding, thiết kế, public pages, media và UX xác thực ban đầu.")}
            </p>
          </li>
          <li>
            <span className="status-tag future">{uiText("Dự kiến · Chưa triển khai tại đây")}</span>
            <h2>Phase 12.2 · Authentication UX & application shell</h2>
            <p>
              {uiText(
                "Hoàn thiện hành trình xác thực và khung ứng dụng trước khi xây các workspace sinh viên và giảng viên. Không cam kết ngày phát hành.",
              )}
            </p>
          </li>
        </ol>
      </Section>
    </>
  );
}
const policies: Record<
  string,
  { label: string; title: string; intro: string; sections: [string, string][] }
> = {
  "/legal/privacy": {
    label: "PRIVACY",
    title: "Hiểu dữ liệu trước khi chia sẻ.",
    intro: "Ghi chú quyền riêng tư cho public web AILSS, mô tả cách bản triển khai này xử lý thông tin.",
    sections: [
      [
        "Phạm vi",
        "Public web cung cấp nội dung giới thiệu, tìm kiếm khóa học và biểu mẫu đăng ký/đăng nhập. Đây là thông tin về bản triển khai; chính sách của đơn vị vận hành cần được công bố trước khi cung cấp dịch vụ thực tế.",
      ],
      [
        "Dữ liệu gửi đến dịch vụ",
        "Tìm kiếm gửi từ khóa đến Course API. Đăng ký gửi tên hiển thị, email và mật khẩu đến Identity API; đăng nhập gửi email và mật khẩu. Không đưa mật khẩu hoặc token vào URL.",
      ],
      [
        "Phiên đăng nhập",
        "Token được giữ tại máy chủ Web. Trình duyệt nhận cookie phiên HttpOnly; không lưu token vào localStorage hoặc sessionStorage. Tải lại trang sẽ xác minh lại hồ sơ. Khởi động lại máy chủ Web làm mất phiên Web; nút đăng xuất yêu cầu thu hồi phiên Identity hiện tại.",
      ],
      [
        "Liên hệ & minh họa",
        "Biểu mẫu liên hệ chỉ tạo tệp bản nháp trên thiết bị, không gửi lên máy chủ. Demo AI và số liệu tiến độ là dữ liệu minh họa cục bộ.",
      ],
      [
        "Theo dõi & bên thứ ba",
        "Public web không tích hợp analytics hoặc quảng cáo. Ảnh, video và nhận diện được phục vụ nội bộ. Tài liệu học tập trong backend dùng lưu trữ riêng tư; việc dùng nhà cung cấp AI phụ thuộc cấu hình triển khai.",
      ],
      [
        "Lưu giữ & yêu cầu dữ liệu",
        "Thời hạn lưu giữ, thông tin đơn vị vận hành và đầu mối xử lý yêu cầu dữ liệu chưa được cấu hình trên public web. Người dùng cần liên hệ quản trị của đơn vị triển khai để có chính sách áp dụng.",
      ],
    ],
  },
  "/legal/terms": {
    label: "TERMS",
    title: "Một không gian học tập có trách nhiệm.",
    intro: "Thông tin sử dụng public web và phạm vi chức năng của bản triển khai hiện tại.",
    sections: [
      [
        "Nội dung công khai",
        "Bạn có thể xem trang giới thiệu và thông tin khóa học đã xuất bản. Không phải mọi khả năng backend đều đã có màn hình thao tác sau đăng nhập.",
      ],
      [
        "Tài khoản",
        "Đăng ký công khai tạo tài khoản sinh viên. Bảo vệ thông tin đăng nhập và chỉ sử dụng tài khoản bạn được quyền truy cập.",
      ],
      [
        "Học liệu & quyền sử dụng",
        "Chỉ tải hoặc chia sẻ tài liệu bạn có quyền sử dụng. Không dùng nội dung của người khác khi chưa có quyền phù hợp.",
      ],
      [
        "AI & quyết định chuyên môn",
        "AI có thể tạo nội dung không chính xác. Giảng viên cần rà soát, chỉnh sửa và phê duyệt; AI không tự xuất bản bài đánh giá.",
      ],
      [
        "Hành vi trong cộng đồng",
        "Trao đổi có tôn trọng. Không chia sẻ thông tin đăng nhập, dữ liệu riêng tư của người khác hoặc nội dung gây hại. Sử dụng quy trình báo cáo khi có vấn đề.",
      ],
      [
        "Phạm vi triển khai",
        "Thông tin pháp nhân vận hành, điều khoản thương mại và điều kiện cung cấp dịch vụ chưa được xác định trên trang này. Đây chưa phải bộ điều khoản vận hành hoàn chỉnh cho dịch vụ thương mại.",
      ],
    ],
  },
  "/legal/cookies": {
    label: "COOKIE POLICY",
    title: "Ít lưu trữ hơn. Minh bạch hơn.",
    intro: "Public web hiện không đặt cookie theo dõi và không dùng công cụ quảng cáo hoặc analytics.",
    sections: [
      [
        "Cookie của frontend",
        "Sau đăng nhập, máy chủ đặt cookie phiên thiết yếu HttpOnly, SameSite=Lax và Secure khi triển khai HTTPS. Cookie dùng để duy trì đăng nhập, không phục vụ quảng cáo.",
      ],
      [
        "Thông tin xác thực",
        "Cookie chỉ chứa mã phiên ngẫu nhiên. Access token và refresh token ở phía máy chủ, không được trả cho JavaScript của trang. Không lưu token vào localStorage, sessionStorage hay IndexedDB.",
      ],
      [
        "Tùy chọn trình duyệt",
        "Bạn có thể dùng cài đặt trình duyệt để quản lý cookie. Cấu hình reverse proxy hoặc đơn vị vận hành có thể thay đổi hành vi; cần cập nhật trang này khi triển khai thêm công cụ.",
      ],
    ],
  },
  "/accessibility": {
    label: "ACCESSIBILITY",
    title: "Việc học nên mở ra với nhiều người hơn.",
    intro:
      "AILSS hướng tới trải nghiệm có thể sử dụng bằng bàn phím, màn hình nhỏ và tùy chọn giảm chuyển động.",
    sections: [
      [
        "Điều hướng",
        "Có skip link đến nội dung chính, focus hiển thị, cấu trúc heading và landmarks. Menu di động và lightbox dùng dialog để quản lý focus và đóng bằng Escape.",
      ],
      [
        "Chuyển động & 3D",
        "Tôn trọng prefers-reduced-motion. Nội dung vẫn có văn bản và ảnh poster khi WebGL không có hoặc màn hình nhỏ. Chuyển động không truyền đạt thông tin duy nhất.",
      ],
      [
        "Hình ảnh & video",
        "Ảnh có mô tả và kích thước xác định. Video có điều khiển, phụ đề tiếng Việt và bản mô tả bằng văn bản, không tự phát âm thanh.",
      ],
      [
        "Biểu mẫu",
        "Input có nhãn; trạng thái và lỗi được thông báo bằng vùng live. Không chỉ dùng màu để diễn đạt trạng thái.",
      ],
      [
        "Cải tiến liên tục",
        "Kiểm thử tự động và kiểm tra bàn phím là nền tảng, không thay thế thử nghiệm với mọi công nghệ hỗ trợ. Chưa tuyên bố chứng nhận tuân thủ. Có thể chuẩn bị phản hồi tại trang liên hệ.",
      ],
    ],
  },
};
export function Policy() {
  const uiText = useUiText();
  const p = policies[useLocation().pathname];
  return (
    <>
      <PageHero label={uiText(p.label)} title={uiText(p.title)} description={uiText(p.intro)} />
      <Section>
        <div className="policy-layout">
          <aside>
            <strong>{uiText("Trong trang này")}</strong>
            {p.sections.map(([title], i) => (
              <a href={`#policy-${i}`} key={title}>
                {uiText(title)}
              </a>
            ))}
            <small>{uiText("Cập nhật: 06.09.2026")}</small>
          </aside>
          <div>
            {p.sections.map(([title, body], i) => (
              <section id={`policy-${i}`} key={title}>
                <h2>{uiText(title)}</h2>
                <p>{uiText(body)}</p>
              </section>
            ))}
            <TextLink to="/contact">{uiText("Chuẩn bị phản hồi")}</TextLink>
          </div>
        </div>
      </Section>
    </>
  );
}

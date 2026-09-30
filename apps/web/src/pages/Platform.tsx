import { ScrollStory } from "../components/ScrollStory";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Section, PageHero, TextLink, ButtonLink, Picture } from "../components/ui";
import { Workflow } from "../components/Workflow";
import { Architecture } from "../components/Architecture";
import { ProgressPreview } from "./Home";
import { Icon } from "../components/Icon";
import { KnowledgeScene } from "../components/KnowledgeScene";

interface BloomCognitiveTier {
  id: string;
  level: string;
  nameVi: string;
  nameEn: string;
  verbs: string;
  color: string;
  glow: string;
  archetype: string;
  sampleQuestion: string;
  rationale: string;
}

const BLOOM_TIERS: BloomCognitiveTier[] = [
  {
    id: "l1",
    level: "Cấp độ 1",
    nameVi: "Nhận biết",
    nameEn: "Remember",
    verbs: "Liệt kê, Định nghĩa, Tái hiện, Nhận diện",
    color: "#0284c7",
    glow: "rgba(2, 132, 199, 0.28)",
    archetype: "Tái hiện chính xác định nghĩa và thuật ngữ cốt lõi từ học liệu",
    sampleQuestion: "Thuật toán nào được sử dụng để phân phối thông điệp trong cụm Kafka Broker?",
    rationale: "Kiểm tra khả năng ghi nhớ tên giao thức và thuật toán mà không yêu cầu suy luận phức tạp.",
  },
  {
    id: "l2",
    level: "Cấp độ 2",
    nameVi: "Thông hiểu",
    nameEn: "Understand",
    verbs: "Giải thích, Tóm tắt, Phân biệt, Diễn giải",
    color: "#7c3aed",
    glow: "rgba(124, 58, 237, 0.28)",
    archetype: "Diễn giải nguyên lý vận hành và nguyên nhân gốc rễ bằng ngôn ngữ học thuật",
    sampleQuestion:
      "Vì sao Consumer Group trong Kafka cần cơ chế Partition Rebalance khi có một node gặp sự cố?",
    rationale: "Đánh giá mức độ thấu hiểu cơ chế phân phối tải và tính sẵn sàng cao (High Availability).",
  },
  {
    id: "l3",
    level: "Cấp độ 3",
    nameVi: "Vận dụng",
    nameEn: "Apply",
    verbs: "Áp dụng, Tính toán, Triển khai, Viết mã",
    color: "#d97706",
    glow: "rgba(217, 119, 6, 0.28)",
    archetype: "Áp dụng công thức, quy tắc hoặc mẫu thiết kế vào bài toán thực tế",
    sampleQuestion:
      "Triển khai mẫu Idempotent Consumer với Redis Deduplication Key để ngăn giao dịch bị nhân đôi.",
    rationale: "Yêu cầu người học vận dụng kiến thức lý thuyết vào mã nguồn và cấu hình kiến trúc cụ thể.",
  },
  {
    id: "l4",
    level: "Cấp độ 4",
    nameVi: "Phân tích",
    nameEn: "Analyze",
    verbs: "Phân rã, So sánh, Định vị lỗi, Đánh đổi",
    color: "#059669",
    glow: "rgba(5, 150, 105, 0.28)",
    archetype: "Phân tích cấu trúc dữ liệu, so sánh ưu nhược điểm kiến trúc và đo lường trade-offs",
    sampleQuestion:
      "So sánh hiệu năng giữa B-Tree Composite Index (A, B) và hai Single Index riêng lẻ khi câu truy vấn lọc theo cả hai trường.",
    rationale: "Rèn luyện tư duy phân tích sâu về cơ chế Index Scan vs Bitmap Index Scan trong PostgreSQL.",
  },
  {
    id: "l5",
    level: "Cấp độ 5",
    nameVi: "Đánh giá",
    nameEn: "Evaluate",
    verbs: "Thẩm định, Phê bình, Đo lường, Bảo mật",
    color: "#dc2626",
    glow: "rgba(220, 38, 38, 0.28)",
    archetype: "Đánh giá rủi ro hệ thống, thẩm định phương án kỹ thuật và kiểm thử biên an toàn",
    sampleQuestion:
      "Đánh giá mức độ ảnh hưởng đến SLA và tính toàn vẹn dữ liệu khi hạ Replication Factor từ 3 xuống 1 để tiết kiệm chi phí.",
    rationale: "Thử thách năng lực ra quyết định kỹ thuật cấp kiến trúc sư với nhận thức rủi ro đầy đủ.",
  },
  {
    id: "l6",
    level: "Cấp độ 6",
    nameVi: "Sáng tạo",
    nameEn: "Create",
    verbs: "Thiết kế, Tích hợp, Quy hoạch, Tối ưu",
    color: "#2563eb",
    glow: "rgba(37, 99, 235, 0.28)",
    archetype: "Thiết kế giải pháp toàn diện kết hợp nhiều công nghệ giải quyết bài toán phức tạp",
    sampleQuestion:
      "Thiết kế kiến trúc hệ thống E-commerce chịu tải 100,000 req/s kết hợp CDC (Debezium), Kafka và Elasticsearch.",
    rationale: "Đỉnh cao của thang Bloom: tổng hợp kiến thức để xây dựng đồ án kỹ thuật hoàn chỉnh.",
  },
];

const FORMAT_SPECS = [
  { id: "pdf", label: "PDF", desc: "Giáo trình và bài giảng scan OCR chất lượng cao" },
  { id: "docx", label: "DOCX", desc: "Đề cương, giáo án Word phân tách tự động theo mục lục" },
  { id: "txt", label: "TXT / MD", desc: "Tài liệu kỹ thuật, ghi chú mã nguồn định dạng chuẩn" },
  { id: "rag", label: "RAG PIPELINE", desc: "Truy hồi ngữ nghĩa riêng tư, không lộ học liệu" },
  { id: "vdb", label: "VECTOR DB", desc: "Lập chỉ mục HNSW vector cosine dưới 15ms" },
  { id: "bloom", label: "BLOOM TAXONOMY", desc: "Chuẩn hóa 6 bậc thang nhận thức sư phạm" },
];

const RAG_SIMULATION_CHUNKS = [
  {
    id: "chk-1",
    tag: "Đoạn 1 · Tổng quan",
    vector: "[0.128, ...1536d]",
    similarity: "98.7% match",
    text: "Hàng đợi At-Least-Once đảm bảo gửi thông điệp ít nhất một lần, tự gửi lại khi timeout.",
  },
  {
    id: "chk-2",
    tag: "Đoạn 2 · Idempotency",
    vector: "[0.751, ...1536d]",
    similarity: "96.4% match",
    text: "Consumer dùng Idempotency Key kết hợp Redis SETNX (TTL 24h) để tránh trừ tiền trùng lặp.",
  },
  {
    id: "chk-3",
    tag: "Đoạn 3 · Giám sát DLQ",
    vector: "[-0.312, ...1536d]",
    similarity: "94.1% match",
    text: "Khi lỗi quá 5 lần retry, thông điệp chuyển vào Dead Letter Queue để xử lý an toàn.",
  },
];

export function AiLearning() {
  const [selectedFormat, setSelectedFormat] = useState<string>("rag");
  const [activeBloomIdx, setActiveBloomIdx] = useState<number>(1);
  const [activeChunkIdx, setActiveChunkIdx] = useState<number>(0);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  const activeBloom = BLOOM_TIERS[activeBloomIdx];

  const handleRunSim = () => {
    setIsSimulating(true);
    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step < RAG_SIMULATION_CHUNKS.length) {
        setActiveChunkIdx(step);
      } else {
        clearInterval(interval);
        setIsSimulating(false);
      }
    }, 1200);
  };

  return (
    <>
      {/* 1. 3D Hero Section */}
      <section className="ai-hero-3d-wrapper">
        <div className="container ai-hero-container">
          <h1 className="ai-hero-title">
            Học Cùng AI: <span className="gradient-text">Tri thức của bạn.</span>
            <br />
            Năng lực mới từ AI thích ứng.
          </h1>

          <p className="ai-hero-desc">
            Hệ sinh thái học tập và khảo thí thích ứng thông minh. Biến học liệu thành câu hỏi chuẩn hóa theo
            thang nhận thức Bloom, kết hợp chặt chẽ với sự rà soát và định hướng sư phạm của giảng viên.
          </p>

          <div className="ai-stat-grid-3d">
            <div className="ai-stat-card-3d">
              <span className="ai-stat-icon-3d">
                <Icon name="layers" size={26} />
              </span>
              <div className="ai-stat-num">8,600+</div>
              <div className="ai-stat-label">Vector Embeddings 3D trong không gian tri thức</div>
            </div>
            <div className="ai-stat-card-3d">
              <span className="ai-stat-icon-3d">
                <Icon name="brain" size={26} />
              </span>
              <div className="ai-stat-num">6 Cấp độ</div>
              <div className="ai-stat-label">Chuẩn hóa ma trận nhận thức Bloom sư phạm</div>
            </div>
            <div className="ai-stat-card-3d">
              <span className="ai-stat-icon-3d">
                <Icon name="class" size={26} />
              </span>
              <div className="ai-stat-num">100% Giảng viên</div>
              <div className="ai-stat-label">Human-in-the-Loop: Rà soát & duyệt từng câu hỏi</div>
            </div>
            <div className="ai-stat-card-3d">
              <span className="ai-stat-icon-3d">
                <Icon name="shield" size={26} />
              </span>
              <div className="ai-stat-num">Zero Leaks</div>
              <div className="ai-stat-label">Cô lập học liệu, bảo mật dữ liệu riêng tư tuyệt đối</div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. 3D Knowledge Scene & Semantic Chunking Section */}
      <section className="ai-knowledge-section">
        <div className="container">
          <div className="ai-knowledge-split">
            <div>
              <h2 className="ai-heading-3d">
                Tri thức chuyển động.
                <br />
                Từ học liệu số.
              </h2>
              <p className="ai-body-text">
                Giáo trình và tài liệu định dạng PDF, DOCX, TXT được phân đoạn ngữ nghĩa (Semantic Chunking),
                lưu trữ bảo mật và tạo Vector Embeddings theo chuẩn RAG Pipeline chuyên sâu trước khi hỗ trợ
                giảng viên biên soạn đề thi.
              </p>

              {/* 3D Interactive Format Tags */}
              <div className="format-tags-3d" role="group" aria-label="Định dạng và Công nghệ hỗ trợ">
                {FORMAT_SPECS.map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    className={`format-pill-3d ${selectedFormat === fmt.id ? "active" : ""}`}
                    onClick={() => setSelectedFormat(fmt.id)}
                    title={fmt.desc}
                  >
                    <span>{fmt.label}</span>
                  </button>
                ))}
              </div>

              {/* Interactive RAG Chunking Simulator */}
              <div className="ai-chunk-simulator-card">
                <div className="ai-sim-header">
                  <span className="ai-sim-tag">
                    <Icon name="zap" size={13} style={{ marginRight: 5, verticalAlign: "-2px" }} />
                    Phân đoạn RAG (Semantic Chunking)
                  </span>
                  <button
                    type="button"
                    className="ai-sim-action-btn"
                    onClick={handleRunSim}
                    disabled={isSimulating}
                  >
                    {isSimulating ? "Đang phân đoạn..." : "▶ Chạy thử"}
                  </button>
                </div>

                <div className="ai-chunks-display">
                  {RAG_SIMULATION_CHUNKS.map((chk, idx) => (
                    <div
                      key={chk.id}
                      className={`ai-chunk-item ${activeChunkIdx === idx ? "active" : ""}`}
                      onClick={() => setActiveChunkIdx(idx)}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="ai-chunk-meta">
                        <span>{chk.tag}</span>
                        <span className="ai-vector-token">
                          {chk.vector} · {chk.similarity}
                        </span>
                      </div>
                      <p style={{ margin: 0 }}>{chk.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* 3D WebGL Galaxy Scene */}
            <div className="ai-scene-frame-3d">
              <KnowledgeScene />
            </div>
          </div>
        </div>
      </section>

      {/* 3. 3D Interactive 6-Step Workflow */}
      <section className="ai-workflow-section">
        <div className="container">
          <div className="section-heading">
            <span className="eyebrow" style={{ display: "inline-block" }}>
              QUY TRÌNH TỰ ĐỘNG HÓA
            </span>
            <h2 className="ai-heading-3d">
              Không bỏ qua
              <br />
              phán đoán của con người.
            </h2>
            <p className="ai-body-text">
              Khám phá quy trình 6 bước tự động từ tài liệu đầu vào đến bài đánh giá nháp sẵn sàng cho người
              học.
            </p>
          </div>
          <Workflow />
        </div>
      </section>

      {/* 4. NEW: 3D Bloom Taxonomy Cognitive Matrix */}
      <section className="ai-bloom-section">
        <div className="container">
          <div className="section-heading">
            <span className="eyebrow" style={{ display: "inline-block" }}>
              THANG ĐO SƯ PHẠM QUỐC TẾ
            </span>
            <h2 className="ai-heading-3d">Ma Trận 6 Cấp Độ Nhận Thức Bloom</h2>
            <p className="ai-body-text">
              Mỗi câu hỏi do trợ lý AI đề xuất đều được kiểm định nghiêm ngặt theo thang đo nhận thức Bloom.
              Nhấp vào từng cấp độ bên dưới để khám phá nguyên lý tạo đề và câu hỏi minh họa 3D.
            </p>
          </div>

          <div className="bloom-grid-3d" role="tablist" aria-label="Các cấp độ Bloom">
            {BLOOM_TIERS.map((tier, idx) => (
              <div
                key={tier.id}
                role="tab"
                tabIndex={0}
                aria-selected={activeBloomIdx === idx}
                className={`bloom-card-3d ${activeBloomIdx === idx ? "active" : ""}`}
                style={
                  {
                    "--bloom-color": tier.color,
                    "--bloom-glow": tier.glow,
                  } as React.CSSProperties
                }
                onClick={() => setActiveBloomIdx(idx)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveBloomIdx(idx);
                  }
                }}
              >
                <span className="bloom-level-badge">{tier.level}</span>
                <div className="bloom-card-name">{tier.nameVi}</div>
                <div className="bloom-card-en">{tier.nameEn}</div>
                <div className="bloom-card-verbs">{tier.verbs}</div>
              </div>
            ))}
          </div>

          {/* 3D Bloom Preview Deck */}
          <div
            className="bloom-preview-deck-3d"
            style={
              {
                "--bloom-active-color": activeBloom.color,
              } as React.CSSProperties
            }
          >
            <div className="bloom-preview-header">
              <div className="bloom-archetype-tag">
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: activeBloom.color,
                    boxShadow: `0 0 10px ${activeBloom.color}`,
                    display: "inline-block",
                  }}
                />
                <span>
                  Mục tiêu sư phạm: {activeBloom.nameVi} ({activeBloom.nameEn})
                </span>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: activeBloom.color }}>
                {activeBloom.level}
              </span>
            </div>

            <div className="bloom-preview-body">
              <h4>{activeBloom.archetype}</h4>
              <p>
                <strong>Cơ sở sư phạm:</strong> {activeBloom.rationale}
              </p>
              <div className="bloom-question-sample-box">
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: activeBloom.color,
                    display: "block",
                    marginBottom: 6,
                  }}
                >
                  CÂU HỎI MẪU DO AI TẠO THEO CHUẨN {activeBloom.nameEn.toUpperCase()}:
                </span>
                <strong>"{activeBloom.sampleQuestion}"</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. 3D Human-in-the-Loop & Trust Guardrails */}
      <section className="ai-trust-section">
        <div className="container">
          <div className="section-heading" style={{ maxWidth: 840 }}>
            <span className="eyebrow" style={{ display: "inline-block" }}>
              AN TOÀN & ĐẠO ĐỨC AI
            </span>
            <h2 className="ai-heading-3d">Đúng cấu trúc chưa có nghĩa là đúng kiến thức.</h2>
            <p className="ai-body-text">
              AI giúp chuẩn bị câu hỏi và phân tích mục tiêu sư phạm. Giảng viên vẫn là người giữ tay lái:
              kiểm tra tính chính xác, mức độ phù hợp và đáp án trước khi duyệt.
            </p>
          </div>

          <div className="ai-trust-cards-grid-3d">
            {/* Card 1: Giảng viên làm chủ */}
            <div className="ai-trust-card-3d">
              <div className="ai-trust-icon-box">
                <Icon name="class" size={28} />
              </div>
              <h3 className="ai-trust-card-title">Quyền Năng & Trọng Trách Giảng Viên</h3>
              <p className="ai-trust-card-desc">
                Cơ chế Human-in-the-Loop bắt buộc: Mọi đề xuất từ AI chỉ dừng ở mức bản thảo, người dạy hoàn
                toàn nắm quyền phê chuẩn cuối cùng.
              </p>
              <ul className="ai-check-list-3d">
                <li>
                  <span className="ai-check-bullet">✓</span>
                  <span>Đối chiếu tài liệu nguồn 1-1 với chỉ số trích dẫn trang & đoạn văn bản.</span>
                </li>
                <li>
                  <span className="ai-check-bullet">✓</span>
                  <span>
                    Thẩm định tính chính xác của phương án đúng và tính sư phạm của các phương án nhiễu.
                  </span>
                </li>
                <li>
                  <span className="ai-check-bullet">✓</span>
                  <span>Tự do hiệu chỉnh độ khó, thang điểm và gợi ý giải thích chi tiết.</span>
                </li>
                <li>
                  <span className="ai-check-bullet">✓</span>
                  <span>Không bao giờ xuất bản tự động khi chưa có chữ ký duyệt của giảng viên.</span>
                </li>
              </ul>
              <ButtonLink to="/ai-quiz">Thử minh họa rà soát câu hỏi ↗</ButtonLink>
            </div>

            {/* Card 2: Hàng rào bảo mật */}
            <div className="ai-trust-card-3d">
              <div className="ai-trust-icon-box">
                <Icon name="shield" size={28} />
              </div>
              <h3 className="ai-trust-card-title">Ranh Giới Bảo Mật & Cô Lập Học Liệu</h3>
              <p className="ai-trust-card-desc">
                Dữ liệu học tập và nghiên cứu của bạn được bảo vệ bởi các lớp bảo mật cấp doanh nghiệp khắt
                khe nhất.
              </p>
              <ul className="ai-check-list-3d">
                <li>
                  <span className="ai-check-bullet">✓</span>
                  <span>Học liệu được mã hóa SHA-256 và cô lập riêng tư theo từng tổ chức.</span>
                </li>
                <li>
                  <span className="ai-check-bullet">✓</span>
                  <span>
                    Tuyệt đối không sử dụng tài liệu của người dùng để huấn luyện mô hình công cộng bên ngoài.
                  </span>
                </li>
                <li>
                  <span className="ai-check-bullet">✓</span>
                  <span>
                    Chỉ chuyển bản đã phê duyệt sang bài đánh giá nháp có mã định danh phiên bản (Immutable
                    Audit Trail).
                  </span>
                </li>
                <li>
                  <span className="ai-check-bullet">✓</span>
                  <span>
                    Không dùng AI thay thế quyết định đánh giá và chấm điểm chính khóa của giảng viên.
                  </span>
                </li>
              </ul>
              <ButtonLink to="/security" secondary>
                Tìm hiểu kiến trúc bảo mật ↗
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      {/* 6. Adaptive 3D ScrollStory */}
      <ScrollStory />
    </>
  );
}

interface SampleQuizQuestion {
  id: string;
  topic: string;
  sourceDoc: string;
  sourceChunk: string;
  bloomLevel: string;
  difficulty: string;
  question: string;
  options: {
    text: string;
    isCorrect: boolean;
    rationale: string;
  }[];
  explanation: string;
}

const SAMPLE_QUESTIONS: SampleQuizQuestion[] = [
  {
    id: "q-dist-01",
    topic: "Kiến trúc Phân tán & Message Queue",
    sourceDoc: "Giao-trinh-He-thong-Phan-tan-2026.pdf (Trang 14, Mục 3.2)",
    sourceChunk:
      '"Trong mô hình phân phối At-Least-Once của Apache Kafka và RabbitMQ, mạng lưới có thể gửi lại cùng một thông điệp nhiều lần (retries). Để tránh việc thực hiện giao dịch tài chính hoặc trừ tồn kho bị trùng lặp, consumer bắt buộc phải triển khai cơ chế xử lý thông điệp lặp an toàn (Idempotent Consumer) dựa trên Deduplication Key..."',
    bloomLevel: "Bloom Level 3: Vận dụng (Application)",
    difficulty: "Trung bình · 1 điểm",
    question: "Vì sao consumer cần xử lý thông điệp lặp an toàn?",
    options: [
      {
        text: "Để việc giao lại không tạo tác động nghiệp vụ trùng.",
        isCorrect: true,
        rationale:
          "Chính xác. Tính chất lũy đẳng (Idempotence) đảm bảo khi một thông điệp được xử lý nhiều lần, trạng thái hệ thống và kết quả nghiệp vụ chỉ thay đổi duy nhất một lần.",
      },
      {
        text: "Để bảo đảm mạng không bao giờ bị gián đoạn.",
        isCorrect: false,
        rationale:
          "Không đúng. Xử lý thông điệp lặp diễn ra ở tầng ứng dụng, không thể ngăn chặn sự cố đứt gãy vật lý của hạ tầng mạng.",
      },
      {
        text: "Để thay thế kiểm tra quyền truy cập.",
        isCorrect: false,
        rationale:
          "Không đúng. Xử lý lặp không có chức năng xác thực (Authentication) hay phân quyền (Authorization).",
      },
    ],
    explanation:
      "Trong kiến trúc hướng sự kiện (EDA), mạng lưới không tin cậy đòi hỏi consumer phải có tính lũy đẳng (Idempotency) để ngăn ngừa các tác vụ bị nhân đôi khi có cơ chế retry.",
  },
  {
    id: "q-db-02",
    topic: "Cơ sở Dữ liệu & Tối ưu hóa Index",
    sourceDoc: "PostgreSQL-Query-Optimization-Guide.pdf (Trang 48, Mục 5.1)",
    sourceChunk:
      '"Quy tắc Leftmost Prefix trong B-Tree Composite Index (A, B, C) quy định rằng bộ tối ưu hóa truy vấn chỉ có thể sử dụng chỉ mục nếu điều kiện WHERE tham chiếu đến cột đầu tiên bên trái (cột A). Nếu truy vấn chỉ lọc theo cột B hoặc C, index scan sẽ bị bỏ qua và chuyển sang sequential scan toàn bảng..."',
    bloomLevel: "Bloom Level 4: Phân tích (Analysis)",
    difficulty: "Nâng cao · 1.5 điểm",
    question: "Khi tạo Composite Index (A, B, C), câu truy vấn nào sau đây sử dụng được Index scan?",
    options: [
      {
        text: "SELECT * FROM orders WHERE A = 10 AND B > 20;",
        isCorrect: true,
        rationale:
          "Chính xác. Điều kiện truy vấn chứa tiền tố tận cùng bên trái (cột A), thỏa mãn nguyên lý Leftmost Prefix của cây chỉ mục B-Tree.",
      },
      {
        text: "SELECT * FROM orders WHERE B = 20 AND C = 30;",
        isCorrect: false,
        rationale:
          "Không đúng. Truy vấn thiếu cột tiền tố A, PostgreSQL sẽ phải quét toàn bộ bảng (Seq Scan) do không thể duyệt cây từ gốc.",
      },
      {
        text: "SELECT * FROM orders WHERE C = 30;",
        isCorrect: false,
        rationale:
          "Không đúng. Cột C nằm ở vị trí thứ ba trong chỉ mục phức hợp, không thể đứng độc lập để kích hoạt Index Scan.",
      },
    ],
    explanation:
      "B-Tree Composite Index được sắp xếp tuần tự theo thứ tự khai báo các cột từ trái sang phải. Truy vấn bắt buộc phải chứa cột bên trái nhất để tận dụng được cây tìm kiếm.",
  },
  {
    id: "q-ai-03",
    topic: "Trí tuệ Nhân tạo & Kỹ thuật RAG",
    sourceDoc: "LangChain-Vector-Search-Best-Practices.pdf (Trang 82, Mục 7.4)",
    sourceChunk:
      '"Kỹ thuật Semantic Chunking chia nhỏ văn bản dài thành các đoạn ngữ nghĩa có tính liên kết chặt chẽ. Kích thước chunk quá lớn sẽ làm loãng vector embedding của câu trả lời, trong khi kích thước chunk quá nhỏ sẽ làm mất ngữ cảnh ngữ pháp cần thiết để LLM tổng hợp thông tin chính xác..."',
    bloomLevel: "Bloom Level 2: Thông hiểu (Comprehension)",
    difficulty: "Cơ bản · 1 điểm",
    question:
      "Mục đích chính của kỹ thuật Chunking trong quy trình Retrieval-Augmented Generation (RAG) là gì?",
    options: [
      {
        text: "Chia nhỏ tài liệu để vector embeddings lưu giữ trọn vẹn ngữ nghĩa cục bộ.",
        isCorrect: true,
        rationale:
          "Chính xác. Giúp thuật toán tìm kiếm vector (Cosine Similarity) truy xuất chính xác đoạn văn bản liên quan nhất tới câu hỏi của người dùng.",
      },
      {
        text: "Nén kích thước file tài liệu để giảm dung lượng ổ cứng lưu trữ.",
        isCorrect: false,
        rationale:
          "Không đúng. Chunking chia nhỏ dữ liệu phục vụ embedding và retrieval, không phải thuật toán nén file (như gzip/zip).",
      },
      {
        text: "Tự động dịch tài liệu sang nhiều ngôn ngữ khác nhau.",
        isCorrect: false,
        rationale: "Không đúng. Chunking không thực hiện chức năng dịch thuật ngôn ngữ.",
      },
    ],
    explanation:
      "Chunking tối ưu hóa kích thước đoạn văn để cân bằng giữa độ chính xác khi truy vấn vector và giới hạn context window của mô hình ngôn ngữ lớn (LLM).",
  },
];

export function AiQuiz() {
  const [selectedTopicIdx, setSelectedTopicIdx] = useState(0);
  const currentSample = SAMPLE_QUESTIONS[selectedTopicIdx];

  const [answer, setAnswer] = useState(0);
  const [approved, setApproved] = useState(false);
  const [title, setTitle] = useState(currentSample.question);
  const [options, setOptions] = useState(currentSample.options);

  // Student test simulation state
  const [studentChoice, setStudentChoice] = useState<number | null>(null);

  const handleSelectTopic = (idx: number) => {
    setSelectedTopicIdx(idx);
    const s = SAMPLE_QUESTIONS[idx];
    setTitle(s.question);
    setOptions(s.options);
    setAnswer(s.options.findIndex((o) => o.isCorrect) >= 0 ? s.options.findIndex((o) => o.isCorrect) : 0);
    setApproved(false);
    setStudentChoice(null);
  };

  const handleReset = () => {
    setApproved(false);
    setAnswer(0);
    setSelectedTopicIdx(0);
    const s = SAMPLE_QUESTIONS[0];
    setTitle(s.question);
    setOptions(s.options);
    setStudentChoice(null);
  };

  return (
    <>
      <PageHero
        label="AI QUIZ SHOWCASE"
        title="Một bản nháp tốt cần một người duyệt."
        description="Thử quy trình rà soát câu hỏi minh họa. Trực quan hóa cách AI phân tích học liệu nguồn, gán cấp độ nhận thức Bloom và chuyển đổi thành đề thi nháp an toàn."
      />
      <Section>
        {/* Stepper Workflow */}
        <div className="ai-quiz-stepper" role="region" aria-label="Quy trình minh họa AI Quiz">
          <div className="ai-quiz-step-item completed">
            <span className="ai-quiz-step-dot">✓</span>
            <span>1. Nạp học liệu PDF</span>
          </div>
          <span style={{ color: "var(--line)" }}>→</span>
          <div className="ai-quiz-step-item completed">
            <span className="ai-quiz-step-dot">✓</span>
            <span>2. AI Soạn câu hỏi &amp; Bloom</span>
          </div>
          <span style={{ color: "var(--line)" }}>→</span>
          <div className={`ai-quiz-step-item ${!approved ? "active" : "completed"}`}>
            <span className="ai-quiz-step-dot">{approved ? "✓" : "3"}</span>
            <span>3. Giảng viên rà soát</span>
          </div>
          <span style={{ color: "var(--line)" }}>→</span>
          <div className={`ai-quiz-step-item ${approved ? "active" : ""}`}>
            <span className="ai-quiz-step-dot">4</span>
            <span>4. Đề thi nháp hoàn chỉnh</span>
          </div>
        </div>

        {/* Topic Selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 24,
            padding: "12px 16px",
            background: "var(--surface-soft)",
            borderRadius: 12,
            border: "1px solid var(--line)",
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", marginRight: 4 }}>
            Đổi chủ đề minh họa:
          </span>
          {SAMPLE_QUESTIONS.map((s, idx) => (
            <button
              key={s.id}
              type="button"
              className={`filter-pill-button ${selectedTopicIdx === idx ? "active" : ""}`}
              onClick={() => handleSelectTopic(idx)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Icon name={idx === 0 ? "radio" : idx === 1 ? "database" : "bot"} size={14} />
              <span>{s.topic}</span>
            </button>
          ))}
        </div>

        <div className="split">
          <div>
            <span className="eyebrow">MINH HỌA TƯƠNG TÁC</span>
            <h2>
              Đọc. Chỉnh sửa.
              <br />
              Rồi quyết định.
            </h2>
            <p>
              Kiểm tra câu hỏi và đáp án trước khi phê duyệt. Trong hệ thống thật, bước tiếp theo tạo bài đánh
              giá nháp, không xuất bản.
            </p>

            {/* Source Document Card */}
            <div className="ai-quiz-source-box">
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span
                  className="kpi-tag accent"
                  style={{ fontSize: 11, display: "inline-flex", alignItems: "center", gap: 5 }}
                >
                  <Icon name="fileText" size={13} />
                  <span>Bằng chứng tài liệu nguồn (Grounding)</span>
                </span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 12.5, color: "var(--muted)", marginBottom: 4 }}>
                {currentSample.sourceDoc}
              </div>
              <blockquote
                style={{
                  margin: "6px 0 0 0",
                  fontStyle: "italic",
                  fontSize: 12.5,
                  color: "var(--ink)",
                  opacity: 0.9,
                }}
              >
                {currentSample.sourceChunk}
              </blockquote>
            </div>

            {/* Bloom taxonomy badge card */}
            <div
              style={{
                marginTop: 14,
                padding: "12px 14px",
                background: "var(--surface-soft)",
                border: "1px solid var(--line)",
                borderRadius: 8,
                fontSize: 12.5,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 4,
                }}
              >
                <span style={{ fontWeight: 700, color: "var(--ink)" }}>{currentSample.bloomLevel}</span>
                <span className="kpi-tag" style={{ fontSize: 11 }}>
                  {currentSample.difficulty}
                </span>
              </div>
              <span style={{ color: "var(--muted)" }}>
                Câu hỏi được AI định hình theo ma trận nhận thức giáo dục chuẩn Bloom.
              </span>
            </div>

            <ol className="check-list" style={{ marginTop: 20 }}>
              <li>Đối chiếu với tài liệu nguồn.</li>
              <li>Kiểm tra câu hỏi và các lựa chọn.</li>
              <li>Xác định đáp án đúng.</li>
              <li>Chỉ phê duyệt khi nội dung phù hợp.</li>
            </ol>
          </div>

          <div className="review-preview">
            <small>Dữ liệu minh họa · chỉ tồn tại trên trang này</small>

            {!approved ? (
              <>
                <label>
                  Câu hỏi
                  <textarea
                    aria-label="Câu hỏi"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      setApproved(false);
                    }}
                    maxLength={500}
                    rows={3}
                  />
                </label>

                <fieldset>
                  <legend>Chọn đáp án đúng</legend>
                  {options.map((opt, i) => (
                    <div
                      key={i}
                      className={`answer ${answer === i ? "selected" : ""}`}
                      style={{ marginBottom: 12 }}
                    >
                      <label
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 10,
                          cursor: "pointer",
                          width: "100%",
                        }}
                      >
                        <input
                          type="radio"
                          name="answer"
                          checked={answer === i}
                          onChange={() => {
                            setAnswer(i);
                            setApproved(false);
                          }}
                          style={{ marginTop: 3 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: answer === i ? 600 : 400, color: "var(--ink)" }}>
                            {opt.text}
                          </div>
                          <div
                            style={{
                              fontSize: 11.5,
                              color: answer === i ? "#16a34a" : "var(--muted)",
                              marginTop: 4,
                            }}
                          >
                            {answer === i ? "✓ Đang chọn làm đáp án đúng" : "Phương án lựa chọn"}
                          </div>
                        </div>
                      </label>
                    </div>
                  ))}
                </fieldset>

                <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16 }}>
                  <button
                    className="button"
                    disabled={!title.trim() || approved}
                    onClick={() => {
                      setApproved(true);
                      setStudentChoice(null);
                    }}
                  >
                    Phê duyệt minh họa
                  </button>
                </div>

                <p role="status">Bản nháp đang chờ bạn rà soát.</p>

                <button className="plain-button" onClick={handleReset}>
                  Đặt lại minh họa
                </button>
              </>
            ) : (
              /* Approved State with Rich Visual Showcase */
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "12px 16px",
                    background: "rgba(16, 185, 129, 0.12)",
                    border: "1px solid #10b981",
                    borderRadius: 10,
                    color: "#15803d",
                    fontWeight: 600,
                    marginBottom: 16,
                  }}
                >
                  <Icon name="checkCircle" size={20} />
                  <span>Đã phê duyệt thành công! Câu hỏi đã sẵn sàng đưa vào Đề thi nháp.</span>
                </div>

                {/* Complete Approved Quiz Card Preview */}
                <div className="ai-quiz-approved-preview">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 12,
                      borderBottom: "1px solid var(--line)",
                      paddingBottom: 10,
                    }}
                  >
                    <span
                      className="kpi-tag accent"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      <Icon name="check" size={13} /> ĐÃ PHÊ DUYỆT (DRAFT ASSESSMENT)
                    </span>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      Mã: #{currentSample.id.toUpperCase()}
                    </span>
                  </div>

                  <h3 style={{ fontSize: "1.15rem", margin: "0 0 14px 0", color: "var(--ink)" }}>{title}</h3>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {options.map((opt, i) => {
                      const isChosenAnswer = answer === i;
                      return (
                        <div
                          key={i}
                          className={`ai-quiz-option-card ${isChosenAnswer ? "correct" : "incorrect"}`}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                fontWeight: isChosenAnswer ? 700 : 500,
                                color: "var(--ink)",
                                fontSize: 13.5,
                              }}
                            >
                              {String.fromCharCode(65 + i)}. {opt.text}
                            </div>
                            {isChosenAnswer ? (
                              <span
                                className="status-pill status-success"
                                style={{ fontSize: 11, flexShrink: 0 }}
                              >
                                ✓ Đáp án đúng
                              </span>
                            ) : (
                              <span style={{ fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
                                Phương án gây nhiễu
                              </span>
                            )}
                          </div>
                          <p
                            style={{
                              margin: "6px 0 0 0",
                              fontSize: 12,
                              color: "var(--muted)",
                              lineHeight: 1.45,
                            }}
                          >
                            <strong>Giải thích:</strong> {opt.rationale}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      padding: "10px 14px",
                      background: "var(--surface-soft)",
                      borderRadius: 8,
                      fontSize: 12.5,
                      color: "var(--muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    <strong>Tóm tắt kiến thức AI:</strong> {currentSample.explanation}
                  </div>
                </div>

                {/* Interactive Student Test Simulation */}
                <div
                  style={{
                    background: "var(--surface-soft)",
                    border: "1px dashed var(--line)",
                    borderRadius: 12,
                    padding: "16px",
                    marginTop: 16,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                    <Icon name="target" size={16} />
                    <strong style={{ fontSize: 13.5, color: "var(--ink)" }}>
                      Làm thử câu hỏi như học viên:
                    </strong>
                  </div>
                  <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px 0" }}>
                    Bấm vào một phương án bên dưới để trải nghiệm phản hồi chấm điểm tức thì:
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {options.map((opt, i) => {
                      const isSelected = studentChoice === i;
                      const isCorrect = answer === i;
                      let classNames = "ai-quiz-test-interactive-option";
                      if (isSelected) {
                        classNames += isCorrect ? " user-selected-correct" : " user-selected-wrong";
                      }
                      return (
                        <div
                          key={i}
                          className={classNames}
                          onClick={() => setStudentChoice(i)}
                          role="button"
                          tabIndex={0}
                          aria-label={`Chọn phương án ${String.fromCharCode(65 + i)}`}
                        >
                          <span
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: "50%",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 12,
                              fontWeight: 700,
                              background: isSelected ? (isCorrect ? "#10b981" : "#ef4444") : "var(--line)",
                              color: isSelected ? "#ffffff" : "var(--ink)",
                              flexShrink: 0,
                            }}
                          >
                            {String.fromCharCode(65 + i)}
                          </span>
                          <div style={{ flex: 1 }}>
                            <div
                              style={{
                                fontSize: 13,
                                color: "var(--ink)",
                                fontWeight: isSelected ? 600 : 400,
                              }}
                            >
                              {opt.text}
                            </div>
                            {isSelected && (
                              <div
                                style={{
                                  marginTop: 6,
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: isCorrect ? "#15803d" : "#b91c1c",
                                }}
                              >
                                {isCorrect ? (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                    <Icon name="checkCircle" size={14} /> Chính xác! (+1.0 điểm) -{" "}
                                    {opt.rationale}
                                  </span>
                                ) : (
                                  <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                                    <Icon name="alert" size={14} /> Chưa chính xác. {opt.rationale}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <p role="status">
                  Đã duyệt trong minh họa. Bước tiếp theo: nhập bài đánh giá nháp. Chưa có quiz nào được tạo.
                </p>

                <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
                  <button
                    className="button button-small button-subtle"
                    onClick={() => {
                      setApproved(false);
                      setStudentChoice(null);
                    }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    <Icon name="pencil" size={13} />
                    <span>Chỉnh sửa lại câu hỏi</span>
                  </button>
                  <button className="plain-button" onClick={handleReset}>
                    Đặt lại minh họa
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Section>
      <Section className="soft">
        <Workflow />
      </Section>
    </>
  );
}

export const featureItems = [
  [
    "Identity & Security",
    "Danh tính và quyền truy cập",
    "Tài khoản, phiên đăng nhập, vai trò và xác minh giảng viên tạo ranh giới cho mỗi thao tác.",
    "/security",
    "Đăng nhập → Kiểm tra quyền → Truy cập",
  ],
  [
    "Courses",
    "Tổ chức tri thức",
    "Khóa học đi qua biên soạn, gửi duyệt và xuất bản; danh mục chỉ hiển thị nội dung công khai.",
    "/courses",
    "Soạn nội dung → Rà soát → Xuất bản",
  ],
  [
    "Course Offering",
    "Đợt mở khóa học",
    "Offering liên kết khóa học với bối cảnh triển khai; điều kiện tham gia được kiểm tra theo quyền.",
    "/classroom",
    "Khóa học → Offering → Lớp học",
  ],
  [
    "Enrollment / Entitlement",
    "Tham gia có kiểm soát",
    "Đăng ký học và quyền truy cập nội dung được quản lý riêng, giúp bảo vệ học liệu.",
    "/students",
    "Khám phá → Đăng ký → Kiểm tra quyền",
  ],
  [
    "Classroom",
    "Kết nối lớp học",
    "Quản lý thành viên, mã tham gia, lịch, phiên học và điểm danh.",
    "/classroom",
    "Thành viên → Phiên học → Điểm danh",
  ],
  [
    "Learning Progress",
    "Theo dõi từng bài học",
    "Trạng thái hoàn thành bài học tạo nên tiến độ khóa học của từng sinh viên.",
    "/progress",
    "Bài học → Hoàn thành → Tiến độ",
  ],
  [
    "Assessment",
    "Đánh giá khách quan",
    "Quiz, lượt làm, nộp bài và kết quả được tổ chức thành quy trình đánh giá.",
    "/assessment",
    "Quiz → Attempt → Kết quả",
  ],
  [
    "Interaction",
    "Không gian trao đổi",
    "Bình luận giúp trao đổi trong ngữ cảnh học tập; nội dung được bảo vệ bằng quyền truy cập.",
    "/students",
    "Đọc → Bình luận → Phản hồi",
  ],
  [
    "Reviews / Rating",
    "Phản hồi trải nghiệm",
    "Người học đủ điều kiện có thể để lại đánh giá khóa học theo quy tắc của hệ thống.",
    "/students",
    "Trải nghiệm → Đánh giá → Rà soát",
  ],
  [
    "Moderation",
    "Chăm sóc không gian chung",
    "Báo cáo và kiểm duyệt hỗ trợ xử lý nội dung không phù hợp.",
    "/security",
    "Báo cáo → Kiểm tra → Xử lý",
  ],
  [
    "Document Processing",
    "Học liệu sẵn sàng cho AI",
    "PDF, DOCX và TXT được xác minh và trích xuất trong quy trình riêng tư.",
    "/ai-learning",
    "Tải lên → Checksum → Trích xuất",
  ],
  [
    "AI Quiz Generation",
    "Từ học liệu đến câu hỏi",
    "AI tạo bản nháp câu hỏi khách quan theo cấu trúc định dạng rõ ràng.",
    "/ai-quiz",
    "Trích xuất → AI → Bản nháp",
  ],
  [
    "Human Approval",
    "Giảng viên quyết định",
    "Giảng viên rà soát và phê duyệt trước khi chuyển sang bài đánh giá nháp.",
    "/ai-learning",
    "Rà soát → Phê duyệt → Biên tập",
  ],
  [
    "Notifications",
    "Không bỏ lỡ cập nhật",
    "Thông báo trong ứng dụng có trạng thái chưa đọc và đã đọc.",
    "/notifications",
    "UNREAD → READ",
  ],
];
export function Features() {
  return (
    <>
      <PageHero
        label="PLATFORM FEATURES"
        title="Mọi phần của việc học. Cùng một hướng đi."
        description="Các khả năng backend đã triển khai, được giải thích qua những hành trình cụ thể. Giao diện ứng dụng sau đăng nhập được phát triển ở giai đoạn tiếp theo."
      />
      <Section>
        <div className="feature-details">
          {featureItems.map(([tag, title, body, to, flow], i) => (
            <article key={tag}>
              <div>
                <span className="eyebrow">
                  {String(i + 1).padStart(2, "0")} / {tag}
                </span>
                <h2>{title}</h2>
                <p>{body}</p>
                <TextLink to={to}>Tìm hiểu thêm</TextLink>
              </div>
              <div className="flow-illustration">
                <small>Minh họa quy trình</small>
                {flow.split(" → ").map((step, index) => (
                  <div key={step}>
                    <span>{index + 1}</span>
                    <strong>{step}</strong>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Section>
    </>
  );
}
export function About() {
  return (
    <>
      <PageHero
        label="ABOUT AILSS"
        title="Công nghệ tốt bắt đầu từ việc hiểu cách con người học."
        description="AILSS kết nối khóa học, lớp học, bài kiểm tra và tiến độ để người học dễ theo dõi hành trình, còn giảng viên có thêm thời gian cho việc dạy."
      />
      <Section>
        <div className="split">
          <Picture name="students" alt="Ảnh minh họa học tập cộng tác trong môi trường đại học" />
          <div>
            <p className="eyebrow">SỨ MỆNH & TẦM NHÌN</p>
            <h2>
              Để tri thức
              <br />
              được kết nối.
            </h2>
            <p>
              Học liệu rời rạc, tiến độ khó theo dõi và nhiều công cụ tách biệt làm gián đoạn việc dạy và học.
              AILSS hướng tới một hành trình nhất quán, từ nội dung đến lớp học và đánh giá.
            </p>
            <p>
              Chúng tôi xây dựng trải nghiệm để người học hiểu bước tiếp theo và giảng viên giữ quyền kiểm
              soát nội dung.
            </p>
          </div>
        </div>
      </Section>
      <Section className="soft">
        <div className="section-heading">
          <h2>Ba nguyên tắc định hướng.</h2>
        </div>
        <div className="three-columns">
          <article>
            <h3>Con người trước tiên</h3>
            <p>
              AI hỗ trợ chuẩn bị câu hỏi. Giảng viên kiểm tra, sửa và phê duyệt; hệ thống không tự xuất bản.
            </p>
          </article>
          <article>
            <h3>Kỹ thuật có bằng chứng</h3>
            <p>
              Một trải nghiệm đáng tin cậy bắt đầu từ những chức năng được kiểm chứng và thông tin rõ ràng với
              người sử dụng.
            </p>
          </article>
          <article>
            <h3>Ranh giới rõ ràng</h3>
            <p>
              Quyền truy cập, tài liệu riêng tư và xử lý thông điệp lặp an toàn là những phần của thiết kế hệ
              thống.
            </p>
          </article>
        </div>
      </Section>
      <Section>
        <div className="split">
          <div>
            <p className="eyebrow">HÀNH TRÌNH DỰ ÁN</p>
            <h2>
              Xây nền móng.
              <br />
              Rồi mở trải nghiệm.
            </h2>
          </div>
          <ol className="timeline">
            <li>
              <strong>Phase 7 · Nghiệp vụ cốt lõi</strong>
              <p>Danh tính, khóa học, lớp học, lịch và quyền học.</p>
            </li>
            <li>
              <strong>Phase 8–9 · Học tập & phản hồi</strong>
              <p>Đánh giá, tiến độ, bình luận, review và kiểm duyệt.</p>
            </li>
            <li>
              <strong>Phase 10–11 · AI & thông báo</strong>
              <p>Học liệu, AI tạo bản nháp, giảng viên duyệt và thông báo trong ứng dụng.</p>
            </li>
            <li>
              <strong>Phase 12.1 · Public web</strong>
              <p>Nhận diện, thiết kế, các trang giới thiệu và nền tảng web.</p>
            </li>
          </ol>
        </div>
      </Section>
      <Section className="dark">
        <div className="split">
          <div>
            <img
              className="brand-story-mark"
              src="/assets/brand/nvd-symbol.svg"
              alt="Biểu tượng NVD nguyên bản"
              width="160"
              height="160"
            />
          </div>
          <div>
            <p className="eyebrow">NVD BRAND STORY</p>
            <h2>
              Một hình khối.
              <br />
              Ba ý tưởng.
            </h2>
            <p>
              N là mạng lưới tri thức. V là hướng tiến lên. D là dữ liệu và không gian số. Những nét hình học
              liên kết thành một dấu hiệu thống nhất, có thể xuất hiện ở kích thước nhỏ hoặc trong chuyển
              động.
            </p>
            <TextLink to="/media">Khám phá nhận diện</TextLink>
          </div>
        </div>
      </Section>
      <Section>
        <div className="split">
          <div>
            <h2>
              Đã có nền tảng.
              <br />
              Còn nhiều điều phía trước.
            </h2>
            <p>
              Backend nghiệp vụ đã hoàn thành theo các giai đoạn 7–11. Trải nghiệm public web đang mở đầu cho
              giao diện ứng dụng, không phải tuyên bố mọi màn hình sau đăng nhập đã sẵn sàng.
            </p>
          </div>
          <div>
            <h3>Hướng phát triển</h3>
            <p>
              Hoàn thiện UX xác thực và khung ứng dụng, rồi phát triển hành trình sinh viên và giảng viên dựa
              trên contract hiện có.
            </p>
            <TextLink to="/roadmap">Xem lộ trình</TextLink>
            <TextLink to="/research">Triết lý nghiên cứu</TextLink>
          </div>
        </div>
      </Section>
    </>
  );
}
const studentJourney = [
  "Khám phá khóa học",
  "Đăng ký tham gia",
  "Học theo bài",
  "Theo dõi tiến độ",
  "Làm bài đánh giá",
  "Trao đổi & phản hồi",
  "Nhận thông báo",
];
const lecturerJourney = [
  "Biên soạn khóa học",
  "Gửi duyệt & xuất bản",
  "Quản lý lớp học",
  "Tải tài liệu",
  "AI tạo bản nháp",
  "Rà soát & phê duyệt",
  "Chuyển sang đánh giá",
];
export function HowItWorks() {
  const [role, setRole] = useState("student");
  const list = role === "student" ? studentJourney : lecturerJourney;
  return (
    <>
      <PageHero
        label="HOW IT WORKS"
        title="Từng bước rõ ràng. Một hành trình liền mạch."
        description="Khám phá cách sinh viên và giảng viên sử dụng các khả năng của AILSS."
      />
      <Section>
        <div className="segmented" aria-label="Chọn hành trình">
          <button aria-pressed={role === "student"} onClick={() => setRole("student")}>
            Sinh viên
          </button>
          <button aria-pressed={role === "lecturer"} onClick={() => setRole("lecturer")}>
            Giảng viên
          </button>
        </div>
        <ol key={role} className="timeline journey-timeline panel-motion">
          {list.map((title, i) => (
            <li key={title}>
              <span className="step-number">0{i + 1}</span>
              <h2>{title}</h2>
              <p>
                {role === "student"
                  ? [
                      "Tìm nội dung công khai phù hợp với điều bạn muốn học.",
                      "Đăng nhập và đáp ứng điều kiện tham gia trước khi truy cập học liệu.",
                      "Đi qua nội dung được tổ chức theo từng bài học.",
                      "Xem bài đã hoàn thành và phần hành trình còn lại.",
                      "Thực hiện lượt làm bài, nộp bài và xem kết quả.",
                      "Bình luận trong ngữ cảnh học tập và đánh giá khi đủ điều kiện.",
                      "Theo dõi cập nhật lớp học ngay trong ứng dụng.",
                    ][i]
                  : [
                      "Chuẩn bị nội dung và tổ chức các bài học trong bản nháp.",
                      "Gửi nội dung qua quy trình duyệt trước khi công khai.",
                      "Tổ chức thành viên, lịch, phiên học và điểm danh.",
                      "Dùng PDF, DOCX hoặc TXT bạn có quyền sử dụng.",
                      "Nhận câu hỏi có cấu trúc từ học liệu được trích xuất.",
                      "Kiểm tra kiến thức, sửa câu hỏi và xác nhận bản phù hợp.",
                      "Nhập bản được duyệt vào bài đánh giá nháp để tiếp tục biên tập.",
                    ][i]}
              </p>
            </li>
          ))}
        </ol>
        <p className="notice">
          Đây là mô tả hành trình sản phẩm. Các màn hình ứng dụng sau đăng nhập thuộc giai đoạn tiếp theo.
        </p>
      </Section>
    </>
  );
}
const experiences: Record<
  string,
  { label: string; title: string; intro: string; heading: string; items: [string, string][] }
> = {
  "/students": {
    label: "STUDENT EXPERIENCE",
    title: "Chủ động hơn trong mỗi bước học.",
    intro: "Khám phá, tham gia, học tập và nhìn lại tiến độ — trong một hành trình có tổ chức.",
    heading: "Từ sự tò mò đến hiểu biết.",
    items: [
      ["Tìm khóa học", "Tra cứu tên khóa học đã xuất bản và xem thông tin công khai trước khi tham gia."],
      ["Học cùng lớp", "Tham gia đúng lớp, theo dõi lịch và các phiên học được tổ chức."],
      ["Biết mình đang ở đâu", "Đánh dấu hoàn thành bài học và theo dõi tiến độ theo khóa học."],
      ["Học từ kết quả", "Làm quiz và xem kết quả chấm khách quan của lượt làm bài."],
      ["Giữ cuộc trao đổi tiếp tục", "Bình luận, phản hồi và review khi đáp ứng điều kiện."],
      ["Theo dõi cập nhật", "Nhận thông báo trong ứng dụng và đánh dấu đã đọc."],
    ],
  },
  "/lecturers": {
    label: "LECTURER EXPERIENCE",
    title: "Tập trung vào điều bạn muốn truyền đạt.",
    intro:
      "Từ biên soạn bài học đến tổ chức lớp và duyệt bản nháp AI, giảng viên luôn giữ vai trò quyết định.",
    heading: "Một quy trình dạy học có kiểm soát.",
    items: [
      ["Biên soạn & xuất bản", "Tạo khóa học, tổ chức bài học, gửi duyệt và theo dõi trạng thái xuất bản."],
      ["Tổ chức lớp học", "Quản lý thành viên, mã tham gia, lịch, phiên học và điểm danh."],
      ["Chuẩn bị quiz", "Biên soạn câu hỏi khách quan và quản lý bài đánh giá."],
      ["AI hỗ trợ từ tài liệu", "Tải tài liệu riêng tư, trích xuất và yêu cầu bản nháp câu hỏi."],
      [
        "Rà soát & phê duyệt",
        "Kiểm tra đáp án, chỉnh sửa câu hỏi và chuyển bản đã duyệt sang bài đánh giá nháp.",
      ],
      ["Nhìn lại kết quả", "Xem kết quả làm bài để hỗ trợ trao đổi về kiến thức với người học."],
    ],
  },
  "/classroom": {
    label: "CLASSROOM EXPERIENCE",
    title: "Một nơi để việc học diễn ra cùng nhau.",
    intro: "Lớp học kết nối con người, thời gian và hoạt động học tập trong một bối cảnh rõ ràng.",
    heading: "Tổ chức lớp, từ thành viên đến phiên học.",
    items: [
      ["Thành viên & mã tham gia", "Quản lý ai thuộc lớp và dùng mã tham gia theo điều kiện của hệ thống."],
      ["Lịch & phiên học", "Sắp xếp lịch và các buổi học, giúp thành viên biết khi nào cần tham gia."],
      ["Điểm danh", "Theo dõi tham gia và xử lý điểm danh theo quy trình được giảng viên quản lý."],
      ["Thông báo lớp", "Cập nhật thông tin lớp qua thông báo trong ứng dụng."],
    ],
  },
  "/assessment": {
    label: "ASSESSMENT EXPERIENCE",
    title: "Đánh giá để hiểu việc học rõ hơn.",
    intro: "Từ câu hỏi đến lượt làm bài, AILSS tổ chức quá trình đánh giá khách quan và kết quả.",
    heading: "Mỗi lượt làm bài có một hành trình.",
    items: [
      ["Quiz có cấu trúc", "Chuẩn bị câu hỏi, lựa chọn và đáp án trong bài đánh giá."],
      ["Lượt làm bài", "Sinh viên bắt đầu và thực hiện lượt làm bài trong phạm vi được phép."],
      ["Nộp & chấm khách quan", "Hệ thống xử lý bài nộp theo quy tắc chấm điểm khách quan đã triển khai."],
      ["Kết quả để xem lại", "Kết quả gắn với lượt làm bài; hỗ trợ người học nhìn lại kiến thức."],
    ],
  },
  "/progress": {
    label: "LEARNING PROGRESS",
    title: "Nhìn thấy hành trình bạn đã đi.",
    intro: "Theo dõi bài học hoàn thành và tiến độ khóa học để tiếp tục việc học có chủ đích.",
    heading: "Từng bài học đều có ý nghĩa.",
    items: [
      ["Hoàn thành bài học", "Trạng thái hoàn thành ghi nhận bước tiến của người học theo bài học."],
      ["Tổng quan khóa học", "Tiến độ tổng hợp giúp nhìn lại phần đã học và phần còn lại."],
      ["Đúng người, đúng nội dung", "Dữ liệu tiến độ gắn với người học và quyền truy cập khóa học."],
    ],
  },
  "/notifications": {
    label: "NOTIFICATION EXPERIENCE",
    title: "Giữ kết nối với những cập nhật cần thiết.",
    intro: "Thông báo trong ứng dụng giúp theo dõi thông tin lớp học và trạng thái đã đọc.",
    heading: "Đọc, ghi nhận và tiếp tục.",
    items: [
      ["Thông báo trong ứng dụng", "Thông tin được trình bày trong ngữ cảnh tài khoản người dùng."],
      ["Chưa đọc → Đã đọc", "Trạng thái UNREAD và READ phân biệt những cập nhật bạn đã xem."],
      ["Câu chuyện lớp học", "Một thông báo lớp đưa cập nhật đến thành viên theo quyền và phạm vi phù hợp."],
    ],
  },
};
export function Experience() {
  const { pathname } = useLocation();
  const p = experiences[pathname];
  const [read, setRead] = useState(false);
  return (
    <>
      <PageHero label={p.label} title={p.title} description={p.intro} />
      <Section>
        <div className="split">
          <div>
            <h2>{p.heading}</h2>
            <p>
              Các khả năng dưới đây đã có trong backend. Đây là trang giới thiệu và minh họa; giao diện làm
              việc sau đăng nhập được triển khai ở giai đoạn tiếp theo.
            </p>
            <ButtonLink to={pathname === "/lecturers" ? "/ai-quiz" : "/courses"}>
              {pathname === "/lecturers" ? "Thử quy trình duyệt" : "Khám phá khóa học"}
            </ButtonLink>
          </div>
          {pathname === "/progress" || pathname === "/students" ? (
            <ProgressPreview />
          ) : pathname === "/notifications" ? (
            <div className="product-preview">
              <small>Minh họa, không phải thông báo thật</small>
              <h3>Cập nhật từ lớp học</h3>
              <p>Giảng viên đã đăng thông báo mới cho lớp.</p>
              <span className="status-tag">{read ? "READ · Đã đọc" : "UNREAD · Chưa đọc"}</span>
              <button className="button" onClick={() => setRead(!read)}>
                {read ? "Đặt lại minh họa" : "Đánh dấu đã đọc (minh họa)"}
              </button>
            </div>
          ) : (
            <Picture name="students" alt="Ảnh minh họa môi trường học tập cộng tác" />
          )}
        </div>
      </Section>
      <Section className="soft">
        <div className="experience-content">
          {p.items.map(([title, body], i) => (
            <article key={title}>
              <span className="step-number">0{i + 1}</span>
              <h2>{title}</h2>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </Section>
      <Section>
        <div className="split">
          <div>
            <h2>Hiểu cách mọi thứ kết nối.</h2>
            <p>Khóa học cung cấp nội dung, lớp học tổ chức hoạt động và đánh giá giúp nhìn lại kiến thức.</p>
          </div>
          <div>
            <TextLink to="/how-it-works">Khám phá hành trình</TextLink>
            <TextLink to="/help">Xem hướng dẫn</TextLink>
          </div>
        </div>
      </Section>
    </>
  );
}
export function ArchitecturePage() {
  return (
    <>
      <PageHero
        label="SYSTEM ARCHITECTURE"
        title="Trách nhiệm rõ ràng. Kết nối có kiểm soát."
        description="Sáu business services cùng các thành phần hạ tầng và tiến trình hỗ trợ. Chọn một service để khám phá trách nhiệm của nó."
      />
      <Section className="dark">
        <Architecture />
      </Section>
      <Section>
        <div className="three-columns">
          <article>
            <h2>Ranh giới dữ liệu</h2>
            <p>
              Cassandra dùng keyspace do từng service sở hữu. Truy vấn được thiết kế từ nhu cầu đọc, thay vì
              dựa vào truy vấn tùy ý xuyên dịch vụ.
            </p>
          </article>
          <article>
            <h2>Ranh giới tin cậy</h2>
            <p>
              Gateway xác thực người dùng; Service JWS và Actor Context truyền ngữ cảnh đã được xác minh giữa
              các thành phần.
            </p>
          </article>
          <article>
            <h2>Xử lý bất đồng bộ</h2>
            <p>
              RabbitMQ và các worker đảm nhiệm công việc nền. Giao nhận ít nhất một lần đòi hỏi xử lý lặp an
              toàn.
            </p>
          </article>
        </div>
        <TextLink to="/research">Đọc về nghiên cứu phân tán</TextLink>
      </Section>
    </>
  );
}

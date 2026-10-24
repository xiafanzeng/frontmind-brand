import { faqs } from "../content";

export function FaqSection() {
  return (
    <section className="hc-section" id="faq">
      <div className="hc-container">
        <div className="hc-section__head">
          <h2 className="hc-section__title">常见问题</h2>
          <p className="hc-section__desc">最常被问到的几个问题。</p>
        </div>
        <div className="hc-faq-grid">
          {faqs.map((faq) => (
            <details key={faq.id} className="hc-faq">
              <summary className="hc-faq__question">
                <span>{faq.question}</span>
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <p className="hc-faq__answer">{faq.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

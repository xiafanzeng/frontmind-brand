import { contactBand } from "../content";

export function ContactBand() {
  return (
    <section className="hc-section">
      <div className="hc-container">
        <div className="hc-contact">
          <div className="hc-contact__copy">
            <h2 className="hc-contact__title">{contactBand.title}</h2>
            <p className="hc-contact__summary">{contactBand.summary}</p>
          </div>
          <a className="hc-button" href="#top">
            {contactBand.action}
          </a>
        </div>
      </div>
    </section>
  );
}

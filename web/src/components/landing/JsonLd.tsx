// Schema.org data for search engines, rendered into the prerendered HTML.
// "<" is escaped so the data can never close the script tag early.
const JsonLd = ({ data }: { data: object }) => (
  <script
    type="application/ld+json"
    dangerouslySetInnerHTML={{
      __html: JSON.stringify(data).replace(/</g, "\\u003c"),
    }}
  />
);

export default JsonLd;

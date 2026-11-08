import { Link } from 'react-router-dom';

export default function AboutPage() {
  return (
    <div className="about-page">
      <aside className="news-about">
        <p className="news-about__brand">
          <span className="news-about__wordmark">project <span className="news-about__accent">rain</span></span>
        </p>
        <p>
          this is a personal passion project aimed at creating a useful and aesthetically pleasing
          pokemon database — effortlessly traversable across multiple types of devices and input
          methods, and free from the clutter and distractions i've encountered while browsing
          others of its kind
        </p>
        <p>
          this project bridges together the foundational software development knowledge i gathered
          during my undergraduate degree with the efficiency of agentic coding tools to bring to life
          one of many projects i've always dreamed of making, but never had the time to set aside
          for
        </p>
        <p>please, enjoy</p>
        <p>— jackson</p>
        <p className="news-about__changelog">
          curious what's new? see the <Link to="/changelog">changelog</Link> →
        </p>
        <ul className="news-about__links">
          <li>
            <a href="https://github.com/rainandrage" target="_blank" rel="noopener noreferrer">
              github
            </a>
          </li>
        </ul>
      </aside>
    </div>
  );
}

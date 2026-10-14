import type { CSSProperties } from "react";

type NetworkTone = "cyan" | "amber" | "coral";

interface NetworkLink {
    readonly d: string;
    readonly tone: NetworkTone;
    readonly delay: number;
}

interface NetworkNode {
    readonly x: number;
    readonly y: number;
    readonly tone: NetworkTone;
    readonly delay: number;
    readonly anchor?: boolean;
}

type NetworkAnimationStyle = CSSProperties & {
    "--network-delay": string;
};

const NETWORK_LINKS: readonly NetworkLink[] = [
    { d: "M -70 650 L 110 596", tone: "cyan", delay: -6.4 },
    { d: "M 110 596 L 250 690", tone: "cyan", delay: -5.8 },
    { d: "M 110 596 L 238 488", tone: "cyan", delay: -5.2 },
    { d: "M 238 488 L 388 548", tone: "cyan", delay: -4.6 },
    { d: "M 388 548 L 520 442", tone: "cyan", delay: -4 },
    { d: "M 250 690 L 430 744", tone: "cyan", delay: -3.4 },
    { d: "M 430 744 L 580 660", tone: "cyan", delay: -2.8 },
    { d: "M 520 442 L 655 515", tone: "cyan", delay: -2.2 },
    { d: "M -40 240 L 150 312", tone: "cyan", delay: -14.1 },
    { d: "M 150 312 L 302 215", tone: "cyan", delay: -13.5 },
    { d: "M 302 215 L 457 306", tone: "cyan", delay: -12.9 },
    { d: "M 457 306 L 590 228", tone: "cyan", delay: -12.3 },
    { d: "M 590 228 L 710 340", tone: "cyan", delay: -11.7 },
    { d: "M 655 515 L 780 650", tone: "cyan", delay: -1.6 },
    { d: "M 780 650 L 928 740", tone: "amber", delay: -11.2 },
    { d: "M 928 740 L 1070 658", tone: "amber", delay: -10.6 },
    { d: "M 1070 658 L 1235 746", tone: "amber", delay: -10 },
    { d: "M 1235 746 L 1475 670", tone: "amber", delay: -9.4 },
    { d: "M 1070 658 L 1126 500", tone: "amber", delay: -9.8 },
    { d: "M 1126 500 L 1290 555", tone: "amber", delay: -9.2 },
    { d: "M 710 340 L 842 350", tone: "coral", delay: -5.5 },
    { d: "M 842 350 L 984 270", tone: "coral", delay: -4.9 },
    { d: "M 984 270 L 1118 340", tone: "coral", delay: -4.3 },
    { d: "M 1118 340 L 1260 240", tone: "coral", delay: -3.7 },
    { d: "M 1260 240 L 1470 320", tone: "coral", delay: -3.1 },
    { d: "M 1118 340 L 1126 500", tone: "coral", delay: -2.5 },
];

const NETWORK_NODES: readonly NetworkNode[] = [
    { x: 110, y: 596, tone: "cyan", delay: -5.8, anchor: true },
    { x: 250, y: 690, tone: "cyan", delay: -5.2 },
    { x: 238, y: 488, tone: "cyan", delay: -4.6 },
    { x: 388, y: 548, tone: "cyan", delay: -4 },
    { x: 520, y: 442, tone: "cyan", delay: -3.4, anchor: true },
    { x: 430, y: 744, tone: "cyan", delay: -2.8 },
    { x: 580, y: 660, tone: "cyan", delay: -2.2 },
    { x: 655, y: 515, tone: "cyan", delay: -1.6 },
    { x: 150, y: 312, tone: "cyan", delay: -13.5 },
    { x: 302, y: 215, tone: "cyan", delay: -12.9, anchor: true },
    { x: 457, y: 306, tone: "cyan", delay: -12.3 },
    { x: 590, y: 228, tone: "cyan", delay: -11.7 },
    { x: 710, y: 340, tone: "cyan", delay: -11.1 },
    { x: 780, y: 650, tone: "amber", delay: -10.6, anchor: true },
    { x: 928, y: 740, tone: "amber", delay: -10 },
    { x: 1070, y: 658, tone: "amber", delay: -9.4, anchor: true },
    { x: 1235, y: 746, tone: "amber", delay: -8.8 },
    { x: 1126, y: 500, tone: "amber", delay: -8.6 },
    { x: 1290, y: 555, tone: "amber", delay: -8 },
    { x: 842, y: 350, tone: "coral", delay: -4.9 },
    { x: 984, y: 270, tone: "coral", delay: -4.3, anchor: true },
    { x: 1118, y: 340, tone: "coral", delay: -3.7 },
    { x: 1260, y: 240, tone: "coral", delay: -3.1, anchor: true },
];

const DUST_STARS = [
    [76, 88, 1.5], [186, 124, 1], [355, 74, 1.8], [518, 148, 1.1],
    [686, 82, 1.2], [806, 174, 1.7], [1018, 86, 1.1], [1164, 136, 1.5],
    [1368, 72, 1], [84, 412, 1], [342, 390, 1.3], [706, 560, 1],
    [862, 438, 1.5], [1028, 596, 1], [1344, 430, 1.8], [136, 810, 1.3],
    [346, 844, 1], [694, 798, 1.6], [886, 852, 1.1], [1180, 842, 1.3],
] as const;

function animationStyle(delay: number): NetworkAnimationStyle {
    return { "--network-delay": `${delay}s` };
}

/**
 * A decorative, code-native map of the Tetherbound frontier. Its links cycle
 * through deployment, outage, and reconnection without any JavaScript timers.
 */
export function MenuNetworkBackground() {
    return (
        <div className="menu-network-background" aria-hidden="true">
            <div className="menu-network-background__nebula menu-network-background__nebula--cyan" />
            <div className="menu-network-background__nebula menu-network-background__nebula--coral" />
            <svg
                className="menu-network-background__svg"
                viewBox="0 0 1440 900"
                preserveAspectRatio="xMidYMid slice"
                focusable="false"
            >
                <defs>
                    <radialGradient id="menu-planet-fill" cx="34%" cy="28%" r="72%">
                        <stop offset="0" stopColor="#294b5b" />
                        <stop offset="0.48" stopColor="#102532" />
                        <stop offset="1" stopColor="#030a11" />
                    </radialGradient>
                    <linearGradient id="menu-planet-ring" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stopColor="#84e7f7" stopOpacity="0" />
                        <stop offset="0.48" stopColor="#84e7f7" stopOpacity="0.45" />
                        <stop offset="1" stopColor="#ffb46f" stopOpacity="0" />
                    </linearGradient>
                </defs>

                <g className="menu-network-background__stars">
                    {DUST_STARS.map(([cx, cy, radius], index) => (
                        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={radius} data-star={index % 3} />
                    ))}
                </g>

                <g className="menu-network-background__orbit menu-network-background__orbit--outer">
                    <ellipse cx="720" cy="450" rx="610" ry="268" />
                </g>
                <g className="menu-network-background__orbit menu-network-background__orbit--inner">
                    <ellipse cx="720" cy="450" rx="430" ry="186" />
                </g>

                <g className="menu-network-background__planet">
                    <circle cx="1308" cy="784" r="132" fill="url(#menu-planet-fill)" />
                    <ellipse cx="1308" cy="784" rx="194" ry="48" fill="none" stroke="url(#menu-planet-ring)" />
                    <path d="M 1200 730 Q 1300 770 1414 724" />
                    <path d="M 1190 808 Q 1304 764 1418 818" />
                </g>

                <g className="menu-network-background__links">
                    {NETWORK_LINKS.map((link) => (
                        <g
                            className={`menu-network-background__tone menu-network-background__tone--${link.tone}`}
                            key={link.d}
                            style={animationStyle(link.delay)}
                        >
                            <path className="menu-network-background__link-bed" d={link.d} />
                            <path className="menu-network-background__link-energy" d={link.d} pathLength="1" />
                            <path className="menu-network-background__link-signal" d={link.d} pathLength="1" />
                        </g>
                    ))}
                </g>

                <g className="menu-network-background__nodes">
                    {NETWORK_NODES.map((node) => (
                        <g
                            className={`menu-network-background__node menu-network-background__tone menu-network-background__tone--${node.tone}${node.anchor ? " menu-network-background__node--anchor" : ""}`}
                            key={`${node.x}-${node.y}`}
                            style={animationStyle(node.delay)}
                        >
                            <circle className="menu-network-background__node-halo" cx={node.x} cy={node.y} r={node.anchor ? 25 : 15} />
                            {node.anchor && (
                                <circle className="menu-network-background__node-ring" cx={node.x} cy={node.y} r="14" />
                            )}
                            <circle className="menu-network-background__node-core" cx={node.x} cy={node.y} r={node.anchor ? 5.5 : 3.5} />
                        </g>
                    ))}
                </g>
            </svg>
            <div className="menu-network-background__veil" />
        </div>
    );
}

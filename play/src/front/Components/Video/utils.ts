import type { UserSimplePeerInterface } from "../../WebRtc/SimplePeer";
import { STUN_SERVER, TURN_PASSWORD, TURN_SERVER, TURN_USER } from "../../Enum/EnvironmentVariable";
import { helpWebRtcSettingsVisibleStore } from "../../Stores/HelpSettingsStore";
import Debug from "debug";

export const debug = Debug("CheckTurn");

export function getColorByString(str: string): string | null {
    let hash = 0;
    if (str.length === 0) {
        return null;
    }
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash;
    }
    let color = "#";
    for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 255;
        const radix = "00" + value.toString(16);
        color += radix.substring(radix.length - 2);
    }
    return color;
}

/**
 * @param color: string
 * @return string
 */
export function getTextColorByBackgroundColor(color: string | null): string {
    if (!color) {
        return "white";
    }
    const rgb = color.slice(1);
    const brightness = Math.round(
        (parseInt(rgb[0] + rgb[1], 16) * 299 +
            parseInt(rgb[2] + rgb[3], 16) * 587 +
            parseInt(rgb[4] + rgb[5], 16) * 114) /
            1000
    );
    return brightness > 125 ? "black" : "white";
}

export function srcObject(node: HTMLVideoElement, stream: MediaStream | null) {
    node.srcObject = stream;
    return {
        update(newStream: MediaStream) {
            if (node.srcObject != newStream) {
                node.srcObject = newStream;
            }
        },
    };
}

export function getIceServersConfig(user: UserSimplePeerInterface): RTCIceServer[] {
    const config: RTCIceServer[] = [];
    if (STUN_SERVER) {
        config.push({
            urls: STUN_SERVER.split(","),
        });
    }
    if (TURN_SERVER) {
        config.push({
            urls: TURN_SERVER.split(","),
            username: user.webRtcUser || TURN_USER,
            credential: user.webRtcPassword || TURN_PASSWORD,
        });
    }
    return config;
}

/**
 * Test STUN and TURN server access
 * @param user UserSimplePeerInterface
 */
export function checkCoturnServer(user: UserSimplePeerInterface) {
    let turnServerReached = false;
    let checkPeerConnexionStatusTimeOut: NodeJS.Timeout | null = null;

    if (!TURN_SERVER) {
        debug("No TURN server configured.");
        return;
    }

    if (window.navigator.userAgent.toLowerCase().indexOf("firefox") != -1) {
        debug("RTC Peer Connection detection development is not available for Firefox browser!");
        return;
    }

    const iceServers = getIceServersConfig(user);

    const pc = new RTCPeerConnection({ iceServers });

    pc.onicecandidate = (e) => {
        turnServerReached = false;

        if (
            (e.target && e.target instanceof RTCPeerConnection && e.target.iceGatheringState === "complete") ||
            e.candidate == null
        ) {
            pc.close();

            debug("onicecandidate => gathering is complete");
            if (!turnServerReached) {
                debug("onicecandidate => no turn server found after gathering complete");
                helpWebRtcSettingsVisibleStore.set("error");
            }
            if (checkPeerConnexionStatusTimeOut) {
                clearTimeout(checkPeerConnexionStatusTimeOut);
                checkPeerConnexionStatusTimeOut = null;
            }
            return;
        }

        debug("onicecandidate => e.candidate.type %s", e.candidate.type);
        // If a srflx candidate was found, notify that the STUN server works!
        /*if (e.candidate.type == "srflx") {
            debugCheckTurn("onicecandidate => The STUN server is reachable!");
            debugCheckTurn(`   Your Public IP Address is: ${e.candidate.address}`);
            valideCoturnCheck = true;
            pc.close();
        }*/

        // If a relay candidate was found, notify that the TURN server works!
        if (e.candidate.type == "relay") {
            debug("onicecandidate => The TURN server is reachable!");
            turnServerReached = true;
            helpWebRtcSettingsVisibleStore.set("hidden");
            pc.close();
        }
    };

    // Log errors:
    // Remember that in most of the cases, even if its working, you will find a STUN host lookup received error
    // Chrome tried to look up the IPv6 DNS record for server and got an error in that process. However, it may still be accessible through the IPv4 address
    pc.onicecandidateerror = (e) => {
        debug("onicecandidateerror => %O", e);
    };

    pc.addEventListener("icegatheringstatechange", (ev) => {
        debug("icegatheringstatechange => pc.iceGatheringState: %s", pc.iceGatheringState);
        switch (pc.iceGatheringState) {
            case "new":
                debug("icegatheringstatechange => status is new");
                break;
            case "gathering":
                debug("icegatheringstatechange => status is gathering");
                break;
            case "complete":
                debug("icegatheringstatechange => status is complete");
                pc.close();
                break;
        }
    });

    pc.createDataChannel("workadventure-peerconnection-test");
    pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch((err) => debug("Check coturn server error => %O", err));

    checkPeerConnexionStatusTimeOut = setTimeout(() => {
        if (!turnServerReached) {
            helpWebRtcSettingsVisibleStore.set("pending");
        }
        if (checkPeerConnexionStatusTimeOut) {
            clearTimeout(checkPeerConnexionStatusTimeOut);
            checkPeerConnexionStatusTimeOut = null;
        }
    }, 5000);
}

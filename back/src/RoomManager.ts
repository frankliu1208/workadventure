import { IRoomManagerServer } from "./Messages/generated/services_grpc_pb";
import {
    AdminGlobalMessage,
    AdminMessage,
    AdminPusherToBackMessage,
    AdminRoomMessage,
    AskPositionMessage,
    BanMessage,
    BanUserMessage,
    BatchToPusherMessage,
    BatchToPusherRoomMessage,
    EmotePromptMessage,
    FollowRequestMessage,
    FollowConfirmationMessage,
    FollowAbortMessage,
    EmptyMessage,
    ItemEventMessage,
    JoinRoomMessage,
    PusherToBackMessage,
    RefreshRoomPromptMessage,
    RoomMessage,
    SendUserMessage,
    ServerToAdminClientMessage,
    SetPlayerDetailsMessage,
    UserMovesMessage,
    VariableMessage,
    WebRtcSignalToServerMessage,
    WorldFullWarningToRoomMessage,
    ZoneMessage,
    LockGroupPromptMessage,
    RoomsList,
    PingMessage,
    QueryMessage,
    EditMapCommandMessage,
    ChatMessagePrompt,
    ServerToClientMessage,
    BatchMessage,
    SubMessage,
} from "./Messages/generated/messages_pb";
import {
    sendUnaryData,
    ServerDuplexStream,
    ServerErrorResponse,
    ServerUnaryCall,
    ServerWritableStream,
} from "@grpc/grpc-js";
import { socketManager } from "./Services/SocketManager";
import {
    emitError,
    emitErrorOnAdminSocket,
    emitErrorOnRoomSocket,
    emitErrorOnZoneSocket,
} from "./Services/MessageHelpers";
import { User, UserSocket } from "./Model/User";
import { GameRoom } from "./Model/GameRoom";
import Debug from "debug";
import { Admin } from "./Model/Admin";
import { clearInterval } from "timers";

const debug = Debug("roommanager");

export type AdminSocket = ServerDuplexStream<AdminPusherToBackMessage, ServerToAdminClientMessage>;
export type ZoneSocket = ServerWritableStream<ZoneMessage, BatchToPusherMessage>;
export type RoomSocket = ServerWritableStream<RoomMessage, BatchToPusherRoomMessage>;

// Maximum time to wait for a pong answer to a ping before closing connection.
// Note: PONG_TIMEOUT must be less than PING_INTERVAL
const PONG_TIMEOUT = 70000; // PONG_TIMEOUT is > 1 minute because of Chrome heavy throttling. See: https://docs.google.com/document/d/11FhKHRcABGS4SWPFGwoL6g0ALMqrFKapCk5ZTKKupEk/edit#
const PING_INTERVAL = 80000;

const roomManager: IRoomManagerServer = {
    joinRoom: (call: UserSocket): void => {
        console.log("joinRoom called");

        let room: GameRoom | null = null;
        let user: User | null = null;
        let pongTimeoutId: NodeJS.Timer | undefined;

        call.on("data", (message: PusherToBackMessage) => {
            // On each message, let's reset the pong timeout
            if (pongTimeoutId) {
                clearTimeout(pongTimeoutId);
                pongTimeoutId = undefined;
            }

            (async () => {
                try {
                    if (room === null || user === null) {
                        if (message.hasJoinroommessage()) {
                            socketManager
                                .handleJoinRoom(call, message.getJoinroommessage() as JoinRoomMessage)
                                .then(({ room: gameRoom, user: myUser }) => {
                                    if (call.writable) {
                                        room = gameRoom;
                                        user = myUser;
                                    } else {
                                        // Connection may have been closed before the init was finished, so we have to manually disconnect the user.
                                        // TODO: Remove this debug line
                                        console.info(
                                            "message handleJoinRoom connection have been closed before. Check 'call.writable': ",
                                            call.writable
                                        );
                                        socketManager.leaveRoom(gameRoom, myUser);
                                    }
                                })
                                .catch((e) => {
                                    console.error("message handleJoinRoom error: ", e);
                                    emitError(call, e);
                                });
                        } else {
                            throw new Error("The first message sent MUST be of type JoinRoomMessage");
                        }
                    } else {
                        if (message.hasJoinroommessage()) {
                            throw new Error("Cannot call JoinRoomMessage twice!");
                        } else if (message.hasUsermovesmessage()) {
                            socketManager.handleUserMovesMessage(
                                room,
                                user,
                                message.getUsermovesmessage() as UserMovesMessage
                            );
                        } else if (message.hasItemeventmessage()) {
                            socketManager.handleItemEvent(
                                room,
                                user,
                                message.getItemeventmessage() as ItemEventMessage
                            );
                        } else if (message.hasVariablemessage()) {
                            await socketManager.handleVariableEvent(
                                room,
                                user,
                                message.getVariablemessage() as VariableMessage
                            );
                        } else if (message.hasWebrtcsignaltoservermessage()) {
                            socketManager.emitVideo(
                                room,
                                user,
                                message.getWebrtcsignaltoservermessage() as WebRtcSignalToServerMessage
                            );
                        } else if (message.hasWebrtcscreensharingsignaltoservermessage()) {
                            socketManager.emitScreenSharing(
                                room,
                                user,
                                message.getWebrtcscreensharingsignaltoservermessage() as WebRtcSignalToServerMessage
                            );
                        } else if (message.hasQuerymessage()) {
                            await socketManager.handleQueryMessage(
                                room,
                                user,
                                message.getQuerymessage() as QueryMessage
                            );
                        } else if (message.hasEmotepromptmessage()) {
                            socketManager.handleEmoteEventMessage(
                                room,
                                user,
                                message.getEmotepromptmessage() as EmotePromptMessage
                            );
                        } else if (message.hasFollowrequestmessage()) {
                            socketManager.handleFollowRequestMessage(
                                room,
                                user,
                                message.getFollowrequestmessage() as FollowRequestMessage
                            );
                        } else if (message.hasFollowconfirmationmessage()) {
                            socketManager.handleFollowConfirmationMessage(
                                room,
                                user,
                                message.getFollowconfirmationmessage() as FollowConfirmationMessage
                            );
                        } else if (message.hasFollowabortmessage()) {
                            socketManager.handleFollowAbortMessage(
                                room,
                                user,
                                message.getFollowabortmessage() as FollowAbortMessage
                            );
                        } else if (message.hasLockgrouppromptmessage()) {
                            socketManager.handleLockGroupPromptMessage(
                                room,
                                user,
                                message.getLockgrouppromptmessage() as LockGroupPromptMessage
                            );
                        } else if (message.hasEditmapcommandmessage()) {
                            if (message.getEditmapcommandmessage())
                                socketManager.handleEditMapCommandMessage(
                                    room,
                                    user,
                                    message.getEditmapcommandmessage() as EditMapCommandMessage
                                );
                        } else if (message.hasSendusermessage()) {
                            const sendUserMessage = message.getSendusermessage();
                            socketManager.handleSendUserMessage(user, sendUserMessage as SendUserMessage);
                        } else if (message.hasBanusermessage()) {
                            const banUserMessage = message.getBanusermessage();
                            socketManager.handlerBanUserMessage(room, user, banUserMessage as BanUserMessage);
                        } else if (message.hasSetplayerdetailsmessage()) {
                            const setPlayerDetailsMessage = message.getSetplayerdetailsmessage();
                            socketManager.handleSetPlayerDetails(
                                room,
                                user,
                                setPlayerDetailsMessage as SetPlayerDetailsMessage
                            );
                        } else if (message.hasPingmessage()) {
                            // Do nothing
                        } else if (message.hasAskpositionmessage()) {
                            socketManager.handleAskPositionMessage(
                                room,
                                user,
                                message.getAskpositionmessage() as AskPositionMessage
                            );
                        } else {
                            throw new Error("Unhandled message type");
                        }
                    }
                } catch (e) {
                    console.error(
                        "An error occurred while managing a message of type PusherToBackMessage:" +
                            message.getMessageCase().toString(),
                        e
                    );
                    emitError(call, e);
                    call.end();
                }
            })().catch((e) => console.error(e));
        });

        const closeConnection = () => {
            if (user !== null && room !== null) {
                socketManager.leaveRoom(room, user);
            }
            if (pingIntervalId) {
                clearInterval(pingIntervalId);
            }
            call.end();
            room = null;
            user = null;
        };

        call.on("end", () => {
            debug("joinRoom ended for user %s", user?.name);
            closeConnection();
        });

        call.on("error", (err: Error) => {
            console.error("An error occurred in joinRoom stream for user", user?.name, ":", err);
            closeConnection();
        });

        // Let's set up a ping mechanism
        const pingMessage = new PingMessage();
        const pingSubMessage = new SubMessage();
        pingSubMessage.setPingmessage(pingMessage);

        const batchMessage = new BatchMessage();
        batchMessage.addPayload(pingSubMessage);

        const serverToClientMessage = new ServerToClientMessage();
        serverToClientMessage.setBatchmessage(batchMessage);

        // Ping requests are sent from the server because the setTimeout on the browser is unreliable when the tab is hidden.
        const pingIntervalId = setInterval(() => {
            call.write(serverToClientMessage);

            if (pongTimeoutId) {
                console.warn("Warning, emitting a new ping message before previous pong message was received.");
                clearTimeout(pongTimeoutId);
            }

            pongTimeoutId = setTimeout(() => {
                console.log(
                    "Connection lost with user ",
                    user?.uuid,
                    user?.name,
                    user?.userJid,
                    "in room",
                    room?.roomUrl
                );
                closeConnection();
            }, PONG_TIMEOUT);
        }, PING_INTERVAL);
    },

    listenZone(call: ZoneSocket): void {
        debug("listenZone called");
        const zoneMessage = call.request;

        socketManager
            .addZoneListener(call, zoneMessage.getRoomid(), zoneMessage.getX(), zoneMessage.getY())
            .catch((e) => {
                emitErrorOnZoneSocket(call, e);
            });

        call.on("cancelled", () => {
            debug("listenZone cancelled");
            socketManager
                .removeZoneListener(call, zoneMessage.getRoomid(), zoneMessage.getX(), zoneMessage.getY())
                .catch((e) => console.error(e));
            call.end();
        });

        call.on("close", () => {
            debug("listenZone connection closed");
            socketManager
                .removeZoneListener(call, zoneMessage.getRoomid(), zoneMessage.getX(), zoneMessage.getY())
                .catch((e) => console.error(e));
        }).on("error", (e) => {
            console.error("An error occurred in listenZone stream:", e);
            socketManager
                .removeZoneListener(call, zoneMessage.getRoomid(), zoneMessage.getX(), zoneMessage.getY())
                .catch((e) => console.error(e));
            call.end();
        });
    },

    listenRoom(call: RoomSocket): void {
        debug("listenRoom called");
        const roomMessage = call.request;

        socketManager.addRoomListener(call, roomMessage.getRoomid()).catch((e) => {
            emitErrorOnRoomSocket(call, e);
        });

        call.on("cancelled", () => {
            debug("listenRoom cancelled");
            socketManager.removeRoomListener(call, roomMessage.getRoomid()).catch((e) => console.error(e));
            call.end();
        });

        call.on("close", () => {
            debug("listenRoom connection closed");
            socketManager.removeRoomListener(call, roomMessage.getRoomid()).catch((e) => console.error(e));
        }).on("error", (e) => {
            console.error("An error occurred in listenRoom stream:", e);
            socketManager.removeRoomListener(call, roomMessage.getRoomid()).catch((e) => console.error(e));
            call.end();
        });
    },

    adminRoom(call: AdminSocket): void {
        console.log("adminRoom called");

        const admin = new Admin(call);
        let room: GameRoom | null = null;

        call.on("data", (message: AdminPusherToBackMessage) => {
            try {
                if (room === null) {
                    if (message.hasSubscribetoroom()) {
                        const roomId = message.getSubscribetoroom();
                        socketManager
                            .handleJoinAdminRoom(admin, roomId)
                            .then((gameRoom: GameRoom) => {
                                room = gameRoom;
                            })
                            .catch((e) => console.error(e));
                    } else {
                        throw new Error("The first message sent MUST be of type JoinRoomMessage");
                    }
                }
            } catch (e) {
                emitErrorOnAdminSocket(call, e);
                call.end();
            }
        });

        call.on("end", () => {
            debug("joinRoom ended");
            if (room !== null) {
                socketManager.leaveAdminRoom(room, admin);
            }
            call.end();
            room = null;
        });

        call.on("error", (err: Error) => {
            console.error("An error occurred in joinAdminRoom stream:", err);
        });
    },
    sendAdminMessage(call: ServerUnaryCall<AdminMessage, EmptyMessage>, callback: sendUnaryData<EmptyMessage>): void {
        socketManager
            .sendAdminMessage(
                call.request.getRoomid(),
                call.request.getRecipientuuid(),
                call.request.getMessage(),
                call.request.getType()
            )
            .catch((e) => console.error(e));

        callback(null, new EmptyMessage());
    },
    sendGlobalAdminMessage(
        call: ServerUnaryCall<AdminGlobalMessage, EmptyMessage>,
        callback: sendUnaryData<EmptyMessage>
    ): void {
        throw new Error("Not implemented yet");
        // TODO
        callback(null, new EmptyMessage());
    },
    ban(call: ServerUnaryCall<BanMessage, EmptyMessage>, callback: sendUnaryData<EmptyMessage>): void {
        // FIXME Work in progress
        socketManager
            .banUser(call.request.getRoomid(), call.request.getRecipientuuid(), call.request.getMessage())
            .catch((e) => console.error(e));

        callback(null, new EmptyMessage());
    },
    sendAdminMessageToRoom(
        call: ServerUnaryCall<AdminRoomMessage, EmptyMessage>,
        callback: sendUnaryData<EmptyMessage>
    ): void {
        // FIXME: we could improve return message by returning a Success|ErrorMessage message
        socketManager
            .sendAdminRoomMessage(call.request.getRoomid(), call.request.getMessage(), call.request.getType())
            .catch((e) => console.error(e));
        callback(null, new EmptyMessage());
    },
    sendWorldFullWarningToRoom(
        call: ServerUnaryCall<WorldFullWarningToRoomMessage, EmptyMessage>,
        callback: sendUnaryData<EmptyMessage>
    ): void {
        // FIXME: we could improve return message by returning a Success|ErrorMessage message
        socketManager.dispatchWorldFullWarning(call.request.getRoomid()).catch((e) => console.error(e));
        callback(null, new EmptyMessage());
    },
    sendRefreshRoomPrompt(
        call: ServerUnaryCall<RefreshRoomPromptMessage, EmptyMessage>,
        callback: sendUnaryData<EmptyMessage>
    ): void {
        // FIXME: we could improve return message by returning a Success|ErrorMessage message
        socketManager.dispatchRoomRefresh(call.request.getRoomid()).catch((e) => console.error(e));
        callback(null, new EmptyMessage());
    },
    getRooms(call: ServerUnaryCall<EmptyMessage, EmptyMessage>, callback: sendUnaryData<RoomsList>): void {
        callback(null, socketManager.getAllRooms());
    },
    ping(call: ServerUnaryCall<PingMessage, EmptyMessage>, callback: sendUnaryData<PingMessage>): void {
        callback(null, call.request);
    },
    sendChatMessagePrompt(
        call: ServerUnaryCall<ChatMessagePrompt, EmptyMessage>,
        callback: sendUnaryData<EmptyMessage>
    ): void {
        socketManager
            .dispatchChatMessagePrompt(call.request)
            .then(() => {
                callback(null, new EmptyMessage());
            })
            .catch((err) => {
                console.error(err);
                callback(err as ServerErrorResponse, new EmptyMessage());
            });
    },
};

export { roomManager };

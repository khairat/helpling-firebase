import cors from 'cors'
import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'
import keyBy from 'lodash.keyby'
import uniq from 'lodash.uniq'

admin.initializeApp(functions.config().firebase)

const region = 'europe-west2'

export const fetchRequest = functions
  .region(region)
  .https.onRequest((request, reply) =>
    cors()(request, reply, async () => {
      const {
        query: { id, kind }
      } = request

      if (!id || !kind) {
        reply.status(401).json({
          error: 'Missing parameters'
        })

        return
      }

      const collection = kind === 'offer' ? 'offers' : 'requests'

      const itemRef = await admin
        .firestore()
        .collection(collection)
        .doc(id as string)
        .get()

      const item = itemRef.data()

      if (!item) {
        reply.status(404).json({
          error: `${kind === 'offer' ? 'Offer' : 'Request'} not found.`
        })

        return
      }

      const commentsRef = await admin
        .firestore()
        .collection('comments')
        .where('itemId', '==', id)
        .get()

      const comments = commentsRef.docs.map((doc) => doc.data())

      const usersRef = await admin
        .firestore()
        .collection('users')
        .where(
          'id',
          'in',
          uniq(
            [
              ...comments.map(({ userId }) => userId),
              item.userId,
              item.helplingId
            ].filter(Boolean)
          )
        )
        .get()

      const users = keyBy(
        usersRef.docs.map((doc) => {
          const { id, name } = doc.data()

          return {
            id,
            name
          }
        }),
        'id'
      )

      item.createdAt = item.createdAt.toDate().toISOString()
      item.updatedAt = item.updatedAt.toDate().toISOString()
      item.user = users[item.userId]

      delete item.userId

      comments.forEach((comment) => {
        comment.createdAt = comment.createdAt.toDate().toISOString()
        comment.user = users[comment.userId]

        delete comment.itemId
        delete comment.itemType
        delete comment.userId
      })

      reply.json({
        comments,
        [kind as string]: item
      })
    })
  )

export const acceptRequest = functions
  .region(region)
  .https.onCall(async ({ id, kind }, { auth }) => {
    if (!auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Need to be authenticated.'
      )
    }

    const collection = kind === 'offer' ? 'offers' : 'requests'

    const itemRef = await admin.firestore().collection(collection).doc(id).get()

    const item = itemRef.data()

    if (!item) {
      throw new functions.https.HttpsError(
        'not-found',
        `${kind === 'offer' ? 'Offer' : 'Request'} not found.`
      )
    }

    if (auth.uid === item.userId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `You cannot accept your own ${kind}.`
      )
    }

    if (item.status !== 'pending') {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid status')
    }

    const threadRef = await admin
      .firestore()
      .collection('threads')
      .add({
        createdAt: new Date(),
        itemId: id,
        itemType: kind,
        updatedAt: new Date(),
        userIds: [item.userId, auth.uid]
      })

    await admin.firestore().collection(collection).doc(id).update({
      helplingId: auth.uid,
      status: 'accepted',
      threadId: threadRef.id,
      updatedAt: new Date()
    })

    const userRef = await admin
      .firestore()
      .collection('users')
      .doc(auth.uid)
      .get()

    const user = userRef.data()

    if (user) {
      await admin.messaging().sendToTopic(`user_${item.userId}`, {
        data: {
          deeplink: `helpling://${collection}/${id}`
        },
        notification: {
          body:
            kind === 'offer'
              ? `${user.name} accepted your offer to help.`
              : `${user.name} has accepted your request for help.`,
          title: `${kind === 'offer' ? 'Offer' : 'Request'} accepted`
        }
      })
    }

    return {
      threadId: threadRef.id
    }
  })

export const completeRequest = functions
  .region(region)
  .https.onCall(async ({ id, kind }, { auth }) => {
    if (!auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'Need to be authenticated.'
      )
    }

    const collection = kind === 'offer' ? 'offers' : 'requests'

    const itemRef = await admin.firestore().collection(collection).doc(id).get()

    const item = itemRef.data()

    if (!item) {
      throw new functions.https.HttpsError(
        'not-found',
        `${kind === 'offer' ? 'Offer' : 'Request'} not found.`
      )
    }

    if (![item.userId, item.helplingId].filter(Boolean).includes(auth.uid)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `You cannot complete someone else's ${kind}.`
      )
    }

    if (kind === 'offer' && auth.uid !== item.helplingId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'You cannot complete your own offer.'
      )
    }

    if (kind === 'request' && auth.uid !== item.userId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `You cannot complete your own request.`
      )
    }

    if (item.status !== 'accepted') {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid status')
    }

    await admin.firestore().collection(collection).doc(id).update({
      status: 'completed'
    })

    const userRef = await admin
      .firestore()
      .collection('users')
      .doc(auth.uid)
      .get()

    const user = userRef.data()

    if (user) {
      await admin.messaging().sendToTopic(`user_${item.userId}`, {
        data: {
          deeplink: `helpling://${collection}/${id}`
        },
        notification: {
          body: `${user.name} completed your ${kind}. Bravo!`,
          title: `${kind === 'offer' ? 'Offer' : 'Request'} completed`
        }
      })
    }

    return {}
  })

const cleanUpAfterItem = async (itemId: string): Promise<void> => {
  const comments = await admin
    .firestore()
    .collection('comments')
    .where('itemId', '==', itemId)
    .get()

  const batch = admin.firestore().batch()

  comments.forEach(({ ref }) => batch.delete(ref))

  const threads = await admin
    .firestore()
    .collection('threads')
    .where('itemId', '==', itemId)
    .limit(1)
    .get()

  threads.forEach(({ ref }) => batch.delete(ref))

  await batch.commit()
}

export const cleanUpOnOfferRemove = functions
  .region(region)
  .firestore.document('offers/{id}')
  .onDelete((doc) => cleanUpAfterItem(doc.id))

export const cleanUpOnRequestRemove = functions
  .region(region)
  .firestore.document('requests/{id}')
  .onDelete((doc) => cleanUpAfterItem(doc.id))

export const onMessageCreate = functions
  .region(region)
  .firestore.document('messages/{id}')
  .onCreate(async (doc) => {
    const message = doc.data()

    if (!message) {
      return
    }

    await admin.firestore().collection('threads').doc(message.threadId).update({
      last: message.body,
      updatedAt: new Date()
    })

    const userRef = await admin
      .firestore()
      .collection('users')
      .doc(message.userId)
      .get()

    const user = userRef.data()

    if (!user) {
      return
    }

    const threadRef = await admin
      .firestore()
      .collection('threads')
      .doc(message.threadId)
      .get()

    const thread = threadRef.data()

    if (!thread) {
      return
    }

    const recipient = thread.userIds
      .filter((id: string) => id !== message.userId)
      .pop()

    if (!recipient) {
      return
    }

    await admin.messaging().sendToTopic(
      `user_${recipient}`,
      {
        data: {
          deeplink: `helpling://messages/${message.threadId}`
        },
        notification: {
          body: message.body,
          title: `${user.name} sent you a message`
        }
      },
      {
        collapseKey: threadRef.id
      }
    )
  })

export const onCommentCreate = functions
  .region(region)
  .firestore.document('comments/{id}')
  .onCreate(async (doc) => {
    const comment = doc.data()

    if (!comment) {
      return
    }

    const collection = comment.itemType === 'offer' ? 'offers' : 'requests'

    await admin.firestore().collection(collection).doc(comment.itemId).update({
      updatedAt: new Date()
    })

    const senderRef = await admin
      .firestore()
      .collection('users')
      .doc(comment.userId)
      .get()

    const sender = senderRef.data()

    if (!sender) {
      return
    }

    const itemRef = await admin
      .firestore()
      .collection(collection)
      .doc(comment.itemId)
      .get()

    const item = itemRef.data()

    if (!item) {
      return
    }

    if (item.userId === comment.userId) {
      return
    }

    await admin.messaging().sendToTopic(
      `user_${item.userId}`,
      {
        data: {
          deeplink: `helpling://${collection}/${comment.itemId}`
        },
        notification: {
          body: comment.body,
          title: `${sender.name} commented on your ${comment.itemType}.`
        }
      },
      {
        collapseKey: itemRef.id
      }
    )
  })

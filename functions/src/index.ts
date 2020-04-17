import * as admin from 'firebase-admin'
import * as functions from 'firebase-functions'

admin.initializeApp(functions.config().firebase)

export const accept = functions.https.onCall(async ({ id, kind }, { auth }) => {
  if (!auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Need to be authenticated.'
    )
  }

  const collection = kind === 'offer' ? 'offers' : 'requests'

  const itemRef = await admin.firestore().collection(`${kind}s`).doc(id).get()

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

  if (['accepted', 'completed'].includes(status)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid status')
  }

  const threadRef = await admin
    .firestore()
    .collection('threads')
    .add({
      createdAt: new Date(),
      itemId: item.id,
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
        deeplink: `helpling://${collection}/${item.id}`
      },
      notification: {
        body: `${user.name} accepted your ${kind}.`,
        title: `${kind === 'offer' ? 'Offer' : 'Request'} accepted`
      }
    })
  }

  return {
    threadId: threadRef.id
  }
})

export const complete = functions.https.onCall(
  async ({ id, kind }, { auth }) => {
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
        `You cannot complete your own ${kind}.`
      )
    }

    if (auth.uid !== item.helplingId) {
      throw new functions.https.HttpsError(
        'permission-denied',
        `You cannot complete someone else's ${kind}.`
      )
    }

    if (['pending', 'completed'].includes(status)) {
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
          deeplink: `helpling://${collection}/${item.id}`
        },
        notification: {
          body: `${user.name} completed your ${kind}.`,
          title: `${kind === 'offer' ? 'Offer' : 'Request'} completed`
        }
      })
    }
  }
)

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

export const cleanUpOnOfferRemove = functions.firestore
  .document('offers/{id}')
  .onDelete((doc) => cleanUpAfterItem(doc.id))

export const cleanUpOnRequestRemove = functions.firestore
  .document('requests/{id}')
  .onDelete((doc) => cleanUpAfterItem(doc.id))

export const onMessageCreate = functions.firestore
  .document('messages/{id}')
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

    await admin.messaging().sendToTopic(`user_${recipient}`, {
      data: {
        deeplink: `helpling://messages/${message.threadId}`
      },
      notification: {
        body: message.body,
        title: `${user.name} sent you a message`
      }
    })
  })

export const onCommentCreate = functions.firestore
  .document('comments/{id}')
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

    await admin.messaging().sendToTopic(`user_${item.userId}`, {
      data: {
        deeplink: `helpling://${collection}/${comment.itemId}`
      },
      notification: {
        body: comment.body,
        title: `${sender.name} commented on your ${comment.itemType}.`
      }
    })
  })
